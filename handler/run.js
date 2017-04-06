// app "run,run,run" handler
const mysql = require('mysql');
const _ = require('underscore');
const moment = require('moment');
const request = require('request');
const crypto = require('crypto');
const Fibers = require('fibers');
const Future = require('fibers/future');

const db = require('../config/db.json');
const agent = require('../config/agent.json');


const agentId = 6;
const messager = global.processor[agentId].messager;
const callbackMessager = global.processor[agentId].callbackMessager;

let queue = {
    checkIn: [],
    checkOut: []
};

// 删除签到和签退队列中60秒以上的事件
const deleteQueue = function () {
    const nowTimestamp = moment().unix();
    queue.checkIn = _.filter(queue.checkIn, (item) => {
        return _.isNumber(item.timestamp) && (nowTimestamp - item.timestamp) < 60;
    });
    queue.checkOut = _.filter(queue.checkOut, (item) => {
        return _.isNumber(item.timestamp) && (nowTimestamp - item.timestamp) < 60;
    });
};
setInterval(deleteQueue, 10000);

const subscribe = function (msg, res) {
    res.send('');
    let resMsg = {
        "touser": "@all",
        "msgtype": "text",
        "agentid": agentId,
        "text": {
            "content": msg.FromUserName + " 加入啦"
        },
        "safe": 0
    };
    messager.sendMessage(resMsg, (err) => {
        if (err) {
            return global.logger.error('run: subscribe: ', err);
        }
    });
};
const unsubscribe = function (msg, res) {
    res.send('');
    let resMsg = {
        "touser": "wangxuan",
        "msgtype": "text",
        "agentid": agentId,
        "text": {
            "content": msg.FromUserName + " 已取消关注"
        },
        "safe": 0
    };
    messager.sendMessage(resMsg, (err) => {
        if (err) {
            return global.logger.error('run: unsubscribe: ', err);
        }
    });
};

const receivedText = function (msg, res) {
    res.send('');
    let resMsg = {
        "touser": msg.FromUserName,
        "msgtype": "text",
        "agentid": agentId,
        "text": {
            "content": msg.Content
        },
        "safe": 0
    };
    messager.sendMessage(resMsg, (err) => {
        if (err) {
            return global.logger.error('run: receivedText: ', err);
        }
    });
}

const checkInStart = function (msg, res) {
    if (msg.SendPicsInfo.PicList.count == '0') {
        return res.send({
            ToUserName: msg.FromUserName,
            FromUserName: msg.ToUserName,
            CreateTime: msg.CreateTime,
            MsgType: 'text',
            Content: '签到失败，请重新拍照签到'
        });
    }
    res.send('');
    const nowTimestamp = moment().unix();
    queue.checkIn.push({
        timestamp: nowTimestamp,
        FromUserName: msg.FromUserName,
        CreateTime: msg.CreateTime,
        md5: msg.SendPicsInfo.PicList.item.PicMd5Sum
    });
}

const checkOutStart = function (msg, res) {
    if (msg.SendPicsInfo.PicList.count == '0') {
        return res.send({
            ToUserName: msg.FromUserName,
            FromUserName: msg.ToUserName,
            CreateTime: msg.CreateTime,
            MsgType: 'text',
            Content: '签退失败，请重新拍照签到'
        });
    }
    res.send('');
    const nowTimestamp = moment().unix();
    queue.checkOut.push({
        timestamp: nowTimestamp,
        FromUserName: msg.FromUserName,
        CreateTime: msg.CreateTime,
        md5: msg.SendPicsInfo.PicList.item.PicMd5Sum
    });
};

const checkImage = function (msg, res) {
    Fibers(() => {
        let resMsg = '';
        // 检查是否是签到的照片
        let checkInInfo = _.find(queue.checkIn, item => item.FromUserName == msg.FromUserName);
        if (checkInInfo) {
            // todo: 应该检查md5是否一致
            queue.checkIn = _.filter(queue.checkIn, item => item.FromUserName != msg.FromUserName);
            resMsg = {
                ToUserName: msg.FromUserName,
                FromUserName: msg.ToUserName,
                CreateTime: msg.CreateTime,
                MsgType: 'text',
                Content: '签到成功'
            };

            let f = new Future;
            // 存入数据库
            const sql = mysql.format('insert into checkin_out(user,in_event_time,in_img_time,in_img_url) value(?,?,?,?)', [msg.FromUserName, checkInInfo.CreateTime, msg.CreateTime, msg.PicUrl]);
            let connection = mysql.createConnection(db.run);
            connection.connect();
            connection.query(sql, (err) => {
                if (err) {
                    global.logger.error('run: checkImage:', sql, err);
                }
                return f.return(err);
            });
            connection.end();
            if (f.wait()) {
                resMsg.Content = '签到失败';
            }
        }

        // 检查是否是签退的照片
        let checkOutInfo = _.find(queue.checkOut, item => item.FromUserName == msg.FromUserName);
        if (checkOutInfo) {
            // todo: 应该检查md5是否一致
            queue.checkOut = _.filter(queue.checkOut, item => item.FromUserName != msg.FromUserName);
            resMsg = {
                ToUserName: msg.FromUserName,
                FromUserName: msg.ToUserName,
                CreateTime: msg.CreateTime,
                MsgType: 'text',
                Content: '签退成功'
            };
            let f = new Future;
            // 更新数据库, 先检查上次签到的信息
            const sql = mysql.format('update checkin_out set out_event_time=?,out_img_time=?,out_img_url=? where id in (select * from (select id from checkin_out where user=? and out_img_time is NULL order by in_img_time limit 1) tmp)', [checkOutInfo.CreateTime, msg.CreateTime, msg.PicUrl, msg.FromUserName]);
            let connection = mysql.createConnection(db.run);
            connection.connect();
            connection.query(sql, (err, result) => {
                if (err) {
                    resMsg.Content = '签退失败';
                    global.logger.error('run: checkImage:', sql, err);
                }
                if (result && result.affectedRows !== 1) {
                    resMsg.Content = '请先签到';
                }
                return f.return();
            });
            connection.end();
            f.wait();
        }
        resMsg = resMsg && callbackMessager.generateResponseMessage(resMsg);
        return res.send(resMsg);
    }).run();
}

module.exports = function (req, res) {
    const msg = callbackMessager.parseRequestMessage(req.body);
    console.log('--- req ---');
    console.dir(msg, {depth: null})

    if (msg.MsgType === 'event') {
        if (msg.Event === 'subscribe') {
            return subscribe(msg, res);
        } else if (msg.Event === 'unsubscribe') {
            return unsubscribe(msg, res);
        } else if (msg.Event === 'pic_sysphoto') {
            if (msg.EventKey === 'RUN_CHECK_IN') {
                return checkInStart(msg, res);
            } else if (msg.EventKey === 'RUN_CHECK_OUT') {
                return checkOutStart(msg, res);
            }
        } else if (msg.Event === 'click') {
            if (msg.EventKey === 'RUN_STATISTIC') {
                return res.send(callbackMessager.generateResponseMessage({
                    ToUserName: msg.FromUserName,
                    FromUserName: msg.ToUserName,
                    CreateTime: msg.CreateTime,
                    MsgType: 'text',
                    Content: '开发中...'
                }));
            }
        }
    } else if (msg.MsgType === 'text') {
        return receivedText(msg, res);
    } else if (msg.MsgType === 'image') {
        return checkImage(msg, res);
    }
    return res.send('');
}
