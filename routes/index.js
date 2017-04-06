const express = require('express');
const router = express.Router();

const runHandler = require('../handler/run');

// 回调验证
router.get('/:agentId', function (req, res, next) {
    const agentId = req.params.agentId;
    const message = global.processor[agentId].callbackMessager.decodeEchoStr(req.query.echostr);
    res.send(message);
});

router.post('/:agentId', function (req, res, next) {
    const agentId = req.params.agentId;

    if (agentId == 6) {
        runHandler(req, res, next);
        return;
    }

    res.send('');
});

module.exports = router;
