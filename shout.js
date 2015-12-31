var config = require('./config');

var TelegramBot = require('node-telegram-bot-api');
var token = config.token;
var bot = new TelegramBot(token, {polling: true});

var ircdkit = require('ircdkit');
var ircd = ircdkit({
	hostname: config.hostname,
	requireNickname: true,
	maxNickLength: 15
});

var groupId = config.group;

var express = require('express')();
var http = require('http').Server(express);
var io = require('socket.io')(http);

var Irc = require('irc');
var irc = new Irc.Client(config.irc_host, config.irc_nick, {
	channels: config.irc_channels
});

var Mpd = require('mpd'), cmd = Mpd.cmd;
var mpd = Mpd.connect({
	port: config.mpd_port,
	host: config.mpd_host
});

var queue = [];
var users = {};
var nowplaying = '';

irc.addListener('message', function (from, to, msg) {
	if (to !== config.irc_channels[1]) return;
	msg = msg.split(' ');
	if (msg[0] != '!nytsoi') return;
	msg.shift();
	msg = msg.join(' ');
	np(msg);
});

function ircmsg(to, msg) {
	irc.say(to, msg);
}

function np(song) {
	if(nowplaying == song) return;
	nowplaying = song;
	var msg = 'Nyt soi: '+song;
	ircmsg(config.irc_channels[0], msg);
	ircdmsg(config.irc_nick, msg);
	telemsg(config.irc_nick, msg);
	socketmsg(config.irc_nick, msg);
	logmsg(config.irc_nick, msg);
	io.emit('np', { song: song });
	console.log(config.irc_nick, msg);
}

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

mpd.on('ready', function() {
	console.log('mpd ready');
});
mpd.on('system-player', function() {
	mpd.sendCommand(cmd('status', []), function (err, msg) {
		if (err) throw err;
		console.log(msg);
		if (msg.match(/state: play/m)) {
			mpd.sendCommand(cmd('currentsong', []), function (err, msg) {
				if (err) throw err;
				var artist = '';
				var title = '';
				var amatch = msg.match(/^Artist: (.*)$/mi);
				var tmatch = msg.match(/^Title: (.*)$/mi);
				if (amatch !== null) {
					artist = amatch[1];
				}
				if (tmatch !== null) {
					title = tmatch[1];
				}
				np(artist+' - '+title);
				console.log(amatch);					
				console.log(tmatch);
				console.log(msg);
			});
		}
	});
});

express.get('/', function (req, res) {
	res.sendFile(__dirname + '/index.html');
});

io.on('connection', function (socket) {
	socket.on('msg', function (msg) {
		if (spam(socket.client.id, msg.text)) return;
		ircdmsg(msg.nick, msg.text);
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

function ircdmsg(nick, msg, id) {
	nick = nick.replace(/[^A-Za-z0-9\-_\^`|]/g, '');
	for (var i in ircd._connections) {
		if (id != ircd._connections[i].id && !ircd._connections[i]._socket.destroyed) {
			ircd._connections[i].send(':'+nick+'!'+nick.toLowerCase()+'@'+config.hostname+' PRIVMSG '+config.ircd_channel+' :'+msg);
		}
	}
}

function telemsg(nick, msg) {
	//bot.sendMessage(groupId, '<'+nick+'> '+msg);
}

function socketmsg(nick, msg) {
	io.emit('msg', { nick: nick, text: msg });
}

ircd.listen(config.ircd_port, function () {
	ircd.on('connection', function (connection) {
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
				if (spam(connection.mask, message)) return;
				telemsg(connection.nickname, message);
				socketmsg(connection.nickname, message);
				ircdmsg(connection.nickname, message, connection.id);
				logmsg(connection.nickname, message);
			}
		});
		connection.on('JOIN', function (target, foo) {
			if(target.match(/^#shoutbox$/i)) {
				for (var i in queue) {
					var nick = queue[i].nick.replace(/[^A-Za-z0-9\-_\^`|]/g, '');
					connection.send(':'+nick+'!'+nick.toLowerCase()+'@'+config.hostname+' PRIVMSG '+config.ircd_channel+' :'+queue[i].text);
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
	if (spam(msg.from.id, msg.text)) return;
	ircdmsg(msg.from.username || msg.from.first_name, msg.text);
	socketmsg(msg.from.username || msg.from.first_name, msg.text);
	logmsg(msg.from.username || msg.from.first_name, msg.text);
});



process.on('uncaughtException', function (er) {
	console.error(er.stack)
});
