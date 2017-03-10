// extended from jsmodbus/src/modbus-tcp-server.js to support connected/disconnected events

var stampit             = require('stampit'),
    ModbusServerCore    = require(__dirname + '/modbus-server-core.js'),
    StateMachine        = require('stampit-state-machine'),
    Put                 = require('put'),
    net                 = require('net');

module.exports = stampit()
    .compose(ModbusServerCore)
    .compose(StateMachine)
    .init(function libmodbusInitTCPServer1() {
        'use strict';

        var server, socketCount = 0, fifo = [];
        var clients = [];
        var buffer  = new Buffer(0);

        var init = function libmodbusInitTCPServer2() {

            if (!this.port) {
                this.port = 502;
            }

            if (!this.hostname) {
                this.hostname = '0.0.0.0';
            }

            server = net.createServer();

            server.on('connection', function libmodbusTCPServerOnConnection(s) {

                this.log.debug('new connection', s.address());

                clients.push(s);
                initiateSocket(s);
                this.emit('connection', s.address());

            }.bind(this));

            server.on('disconnect', function libmodbusTCPServerOnDisconnect(s) {
                this.emit('close', s.address());
            });

            server.listen(this.port, this.hostname, function libmodbusTCPServerOnListen(err) {

                if (err) {

                    this.log.debug('error while listening', err);
                    this.emit('error', err);

                }

            }.bind(this));

            this.log.debug('server is listening on port', this.hostname + ':' + this.port);

            this.on('newState_ready', flush);

            this.setState('ready');

        }.bind(this);

        var onSocketEnd = function libmodbusTCPServerOnSocketEnd(socket, socketId) {

            return function libmodbusTCPServerOnSocketEnd() {
                this.emit('close');
                this.log.debug('connection closed, socket', socketId);
                //clients[socketId-1].destroy();
                delete clients[socketId-1];

            }.bind(this);

        }.bind(this);

        var onSocketData = function libmodbusTCPServerOnSocketData1(socket, socketId) {

            return function libmodbusTCPServerOnSocketData2(data) {

                this.log.debug('received data socket', socketId, data.byteLength);

                buffer = Buffer.concat([buffer, data]);

                while (buffer.length > 8) {

                    // 1. extract mbap

                    var len     = buffer.readUInt16BE(4);
                    var request = {
                        trans_id: buffer.readUInt16BE(0),
                        protocol_ver: buffer.readUInt16BE(2),
                        unit_id: buffer.readUInt8(6)
                    };

                    this.log.debug('MBAP extracted');

                    // 2. extract pdu
                    if (buffer.length < 7 + len - 1) {
                        break; // wait for next bytes
                    }

                    var pdu = buffer.slice(7, 7 + len - 1);

                    this.log.debug('PDU extracted');

                    // emit data event and let the
                    // listener handle the pdu

                    fifo.push({ request : request, pdu : pdu, socket : socket });

                    flush();

                    buffer = buffer.slice(pdu.length + 7, buffer.length);
                }

            }.bind(this);

        }.bind(this);

        var flush = function libmodbusTCPServerFlush() {

            if (this.inState('processing')) {
                return;
            }

            if (fifo.length === 0) {
                return;
            }

            this.setState('processing');

            var current = fifo.shift();

            this.onData(current.pdu, function libmodbusTCPServerOnSocketDataResp(response) {

                this.log.debug('sending tcp data');

                var pkt = Put()
                    .word16be(current.request.trans_id)         // transaction id
                    .word16be(current.request.protocol_ver)     // protocol version
                    .word16be(response.length + 1)      // pdu length
                    .word8(current.request.unit_id)             // unit id
                    .put(response)                      // the actual pdu
                    .buffer();

                current.socket.write(pkt);

                this.setState('ready');

            }.bind(this));

        }.bind(this);

        var onSocketError = function libmodbusTCPServerOnSocketError1(socket, socketCount) {

            return function libmodbusTCPServerOnSocketError2(e) {
                this.emit('error', e);

                this.logError('Socket error', e);

            }.bind(this);


        }.bind(this);

        var initiateSocket = function libmodbusTCPServerInitSocket(socket) {

            socketCount += 1;

            socket.on('end', onSocketEnd(socket, socketCount));
            socket.on('data', onSocketData(socket, socketCount));
            socket.on('error', onSocketError(socket, socketCount));

        }.bind(this);

        this.close = function libmodbusTCPServerClientClose(cb) {

            for(var c in clients) {
                clients[c].destroy()
            }

            server.close(function libmodbusTCPServerClose() {
                server.unref();
                if(cb) { cb() }
            });

        };

        this.getClients = function libmodbusTCPServerClientGet() {
            return clients;
        };

        init();


    });
