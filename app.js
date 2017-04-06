const express = require('express');
const path = require('path');
const favicon = require('serve-favicon');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const log4js = require('log4js');
const _ = require('underscore');
const agent = require('./config/agent.json');
const Messager = require('./libs/wechat_messager').Messager;
const CallbackMessager = require('./libs/wechat_messager').CallbackMessager;

global.logger = log4js.getLogger();

// 回调和发送消息的处理器每个agent全局有一个
global.processor = {};
_.each(agent, (agentInfo) => {
    global.processor[agentInfo.agentId] = {
        messager: new Messager(agentInfo.corpId, agentInfo.corpSerect),
        callbackMessager: new CallbackMessager(agentInfo.token, agentInfo.aesKey, agentInfo.agentId)
    };
});


const index = require('./routes/index');
const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.text({type: 'text/*'}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    let err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handler
app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    global.logger.error(err);
    res.send('');
});

module.exports = app;
