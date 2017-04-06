const util = require('util');
const request = require('request');
const WechatCrypto = require('wechat-crypto');
const xml2jsonParser = require('xml2json');
const _ = require('underscore');

const apiCgi = 'https://qyapi.weixin.qq.com/cgi-bin';

// 主动发送消息的接口，利用access_token
class Messager {
    constructor(corpid, corpsecret) {
        if (!corpid || !corpsecret) {
            throw new Error('Messager: constructor: 参数错误')
        }
        this.corpid = corpid;
        this.corpsecret = corpsecret;
        this.accessToken = '';

        this.getAccessToken = this.getAccessToken.bind(this);

        this.getAccessToken();
    }

    // 获取token，并定时更新
    getAccessToken() {
        const url = apiCgi + '/gettoken';
        request({
            url: url,
            method: 'GET',
            json: true,
            qs: {
                corpid: this.corpid,
                corpsecret: this.corpsecret
            }
        }, (err, resp, body) => {
            if (err) {
                throw err;
            }
            if (!body || !body.access_token) {
                throw new Error(JSON.stringify(body));
            }

            this.accessToken = body.access_token;
            setTimeout(this.getAccessToken, body.expires_in * 500);
        });
    }

    // 获取部门列表
    getDepartmentList(id, callback) {
        if (typeof id === 'function') {
            callback = id;
            id = '';
        }
        const url = apiCgi + '/department/list';
        request({
            url: url,
            method: 'GET',
            json: true,
            qs: {
                access_token: this.accessToken,
                id: id
            }
        }, (err, resp, body) => {
            if (err) {
                return callback(err);
            }
            if (body.errcode !== 0) {
                return callback(body.errmsg);
            }
            return callback(null, body.department);
        });
    }

    // 发送消息
    sendMessage(params, callback) {
        console.log('--- res ---');
        console.log(params);
        const url = apiCgi + '/message/send';
        request({
            url: url,
            method: 'POST',
            json: true,
            qs: {
                access_token: this.accessToken
            },
            body: params
        }, (err, resp, body) => {
            if (err) {
                return callback(err);
            }
            if (body.errcode !== 0) {
                return callback(body.errmsg);
            }
            return callback(null);
        });
    }
}

// 被动回调处理消息和发送消息的接口
class CallbackMessager {
    constructor(token, aesKey, agentId) {
        if (!token || !aesKey || (agentId !== 0 && !agentId)) {
            throw new Error('CallbackMessageProcessor: constructor 参数错误');
        }
        this.token = token;
        this.aesKey = aesKey;
        this.agentId = agentId;
        this.wechatCrypto = new WechatCrypto(token, aesKey, agentId);
    }

    // 首次验证echo str
    decodeEchoStr(text) {
        const message = this.wechatCrypto.decrypt(text);
        if (!_.isObject(message) || !message.message) {
            return null;
        }
        return message.message;
    }

    // 解析请求来的xml数据
    parseRequestMessage(msg) {
        let message = xml2jsonParser.toJson(msg, {object: true});
        if (!message.xml || !message.xml.Encrypt) {
            return null;
        }
        message = message.xml;

        const encryptData = this.wechatCrypto.decrypt(message.Encrypt);
        if (!encryptData || !encryptData.message) {
            return null;
        }

        message = xml2jsonParser.toJson(encryptData.message, {object: true});
        if (!_.isObject(message) || !_.isObject(message.xml)) {
            return null;
        }
        return message.xml;
    }

    // 生成xml数据
    generateResponseMessage(msg) {
        let message;
        switch (msg.MsgType) {
            case 'text':
                message = this.generateTextMessage(msg);
                break;
            default:
                message = null;
        }
        return message;
    }

    generateTextMessage(msg) {
        const nowTimestamp = Math.ceil(new Date().getTime() / 1000);
        let resMsg = `<xml><ToUserName><![CDATA[${msg.ToUserName}]]></ToUserName><FromUserName><![CDATA[${msg.FromUserName}]]></FromUserName><CreateTime>${msg.CreateTime}</CreateTime><MsgType><![CDATA[${msg.MsgType}]]></MsgType><Content><![CDATA[${msg.Content}]]></Content></xml>`
        resMsg = this.wechatCrypto.encrypt(resMsg);
        const signature = this.wechatCrypto.getSignature(nowTimestamp, 0, resMsg);
        resMsg = `<xml><Encrypt><![CDATA[${resMsg}]]></Encrypt><MsgSignature><![CDATA[${signature}]]></MsgSignature><TimeStamp>${nowTimestamp}</TimeStamp><Nonce><![CDATA[0]]></Nonce></xml>`
        return resMsg;
    }
}

module.exports.Messager = Messager;
module.exports.CallbackMessager = CallbackMessager;

