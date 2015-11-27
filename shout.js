var config = require('./config');

var TelegramBot = require('node-telegram-bot-api');
var token = config.token;
var bot = new TelegramBot(token, {polling: true});

var ircdkit = require('ircdkit');
var irc = ircdkit({
	hostname: config.hostname,
	requireNickname: true,
	maxNickLength: 15
});
var groupId = config.group;

var express = require('express')();
var http = require('http').Server(express);
var io = require('socket.io')(http);

var queue = [];
var users = {};

function spam(id, text) {
	if (text.length > 1000) return true;
	if (!users[id]) users[id] = 0;
	users[id]++;
	if (users[id] > 7) {
		users[id] = 67;
		return true;
	}
	return false;
}

setInterval(function () {
	for (var id in users) {
		if(users.hasOwnProperty(id) && users[id] > 0) {
			users[id]--;
		}
	}
}, 1000);

express.get('/', function (req, res) {
	res.sendFile(__dirname + '/index.html');
});

io.on('connection', function (socket) {
	socket.on('msg', function (msg) {
		if (spam(socket.client.id)) return;
		ircmsg(msg.nick, msg.text);
		telemsg(msg.nick, msg.text);
		socketmsg(msg.nick, msg.text);
		logmsg(msg.nick, msg.text);
		console.log(msg.nick, msg.text);
	});
	for (var i in queue) {
		socket.emit('msg', queue[i]);
	}
});

http.listen(config.http_port);

function logmsg(nick, msg) {
	queue.push({ nick: nick, text: msg });
	if (queue.length > config.history) {
		queue.shift();
	}
}

function ircmsg(nick, msg, id) {
	nick = nick.replace(/[^A-Za-z0-9\-_\^`|]/g, '');
	for (var i in irc._connections) {
		if (id != irc._connections[i].id && !irc._connections[i]._socket.destroyed) {
			irc._connections[i].send(':'+nick+'!'+nick.toLowerCase()+'@'+config.hostname+' PRIVMSG '+config.channel+' :'+msg);
		}
	}
}

function telemsg(nick, msg) {
	bot.sendMessage(groupId, '<'+nick+'> '+msg);
}

function socketmsg(nick, msg) {
	io.emit('msg', { nick: nick, text: msg });
}

irc.listen(config.irc_port, function () {
	irc.on('connection', function (connection) {
		connection.on('authenticated', function () {
			console.log(connection.mask, 'connected');
		});
		connection.on('disconnected', function () {
			console.log(connection.mask, 'disconnected');
		});
		connection.on('end', function () {
			console.log(connection.mask, 'ended');
		});
		connection.on('closing', function () {
			console.log(connection.mask, 'closing');
		});
		connection.on('error', function (error) {
			console.log(connection.mask, error);
		});
		connection.on('PRIVMSG', function (target, message) {
			if (target.match(/^#shoutbox$/i)) {
				if (spam(connection.mask)) return;
				telemsg(connection.nickname, message);
				socketmsg(connection.nickname, message);
				ircmsg(connection.nickname, message, connection.id);
				logmsg(connection.nickname, message);
			}
		});
		connection.on('JOIN', function (target, foo) {
			if(target.match(/^#shoutbox$/i)) {
				for (var i in queue) {
					var nick = queue[i].nick.replace(/[^A-Za-z0-9\-_\^`|]/g, '');
					connection.send(':'+nick+'!'+nick.toLowerCase()+'@'+config.hostname+' PRIVMSG '+config.channel+' :'+queue[i].text);
				}
			}
		});
		connection.on('PING', function (target) {
			connection.send('PONG '+target);
		});
	});
});

bot.on('message', function (msg) {
	if (!msg.text || msg.text.match(/^\//)) return;
	if (msg.chat.id != groupId) return;
	if (spam(msg.from.id)) return;
	ircmsg(msg.from.username || msg.from.first_name, msg.text);
	socketmsg(msg.from.username || msg.from.first_name, msg.text);
	logmsg(msg.from.username || msg.from.first_name, msg.text);
});

process.on('uncaughtException', function (er) {
	console.error(er.stack)
});
