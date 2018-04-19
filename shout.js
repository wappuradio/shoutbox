var config = require('./config');

var fs = require('fs');

var TelegramBot = require('node-telegram-bot-api');
var token = config.token;
var bot = new TelegramBot(token, {polling: true});
var groupId = config.group;

var ircdkit = require('ircdkit');
var ircd = ircdkit({
	hostname: config.hostname,
	requireNickname: true,
	maxNickLength: 15
});

var express = require('express')();
var http = require('http').Server(express);
var io = require('socket.io')(http);
var request = require('request');

var Irc = require('irc');
var irc = new Irc.Client(config.irc_host, config.irc_nick, {
	userName: config.irc_user,
	realName: config.irc_name,
	channels: config.public_channels.concat(config.private_channels)
});

var queue = [], users = {}, lastsong = '', lasttime;

function private(chan) {
	for (var i in config.private_channels) {
		if (config.private_channels[i].split(/ /)[0] == chan.toLowerCase()) {
			return true;
		}
	}
	return false;
}

irc.addListener('message', function (from, to, msg) {
	cmd(from, to, msg);
	feed(from, to, msg);
});

function feed(from, to, msg) {
	io.to('info').emit('feed', { from: from, to: to, msg: msg, private: private(to) });
}

function cmd(from, to, msg) {
	msg = msg.trim().split(' ');
	var cmd = msg[0];
	msg.shift();
	var arg = msg.join(' ');
	if (cmd == '!nytsoi' && private(to)) {
		np(arg);
	} else if (cmd == '!levytoive' && private(to)) {
		toive(arg, from, to, config.levytoiveet);
	} else if (cmd == '!toive' || (cmd.match(/^\/toive(@ShoutboxBot)?$/) && to == 'Telegram')) {
		toive(arg, from, to, config.biisitoiveet);
	}
}

function toive(what, who, where, file) {
	var when = new Date().toISOString();
	fs.readFile(file, 'utf8', function (err, data) {
		if (err) {
			return console.log(err);
		}
		var newData = data.replace(/<\/sortable><\/searchtable>/g, '| '+when+' | %%'+who+'%% | %%'+where+'%% | %%'+what+'%% |\n</sortable></searchtable>');
		fs.writeFile(file, newData, 'utf8', function (err) {
			if (err) {
				return console.log(err);
			}
		})
	});
	//fs.appendFile(file, '| '+when+' | %%'+who+'%% | %%'+where+'%% | %%'+what+'%% |\n');
}

function ircmsg(to, msg) {
	irc.say(to, msg);
}

function np(song) {
	if (!song) song = '';
	song = song.trim();
	if ( song == '' ) {
		request({
			url: config.np_url,
		}, function (error, response, body) {
			if (!error && response.statusCode === 200) {
				if (body != '') {
					console.log(body);
					sendnp(body);
					lastsong = body;
					var now = new Date();
					lasttime = now.toISOString();
				}
			}
		});
	} else if (song != lastsong) {
		sendnp(song);
		lastsong = song;
		var now = new Date();
		lasttime = now.toISOString();
	}
}

function sendnp(song) {
	var msg = 'Nyt soi: '+song;
	var telemsg = 'Nyt soi: *'+song+'*';
	for (var i in config.public_channels) {
		irc.send('NOTICE', config.public_channels[i], msg);
	}
	ircdmsg(config.irc_nick, msg);
	bot.sendMessage(groupId, telemsg, { parse_mode: 'Markdown' });
	//telemsg(config.irc_nick, msg);
	socketmsg(config.irc_nick, msg);
	logmsg(config.irc_nick, msg);
	io.emit('np', { song: song });
	console.log(config.irc_nick, msg);
}

function spam(id, text) {
	if (text.length > 400) return true;
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

express.get('/info', function (req, res) {
	res.sendFile(__dirname + '/info.html');
});

express.get('/np', function (req, res) {
	res.setHeader('Content-Type', 'application/json');
	res.send(JSON.stringify({ song: lastsong, timestamp: lasttime }));
});

io.on('connection', function (socket) {
	/*socket.on('msg', function (msg) {
		if (spam(socket.client.id, msg.text)) return;
		if(msg.nick.length > 20) { return; }
		cmd(msg.nick, 'Shoutbox', msg.text);
		feed(msg.nick, 'Shoutbox', msg.text);
		ircdmsg(msg.nick, msg.text);
		telemsg(msg.nick, msg.text);
		socketmsg(msg.nick, msg.text);
		logmsg(msg.nick, msg.text);
		console.log(msg.nick, msg.text);
	});*/
	socket.on('info', function (info) {
		if (info.secret == config.secret) {
			socket.join('info');
		}
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
	bot.sendMessage(groupId, '<'+nick+'> '+msg);
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
				cmd(connection.nickname, '#shoutbox', message);
				feed(connection.nickname, '#shoutbox', message);
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
	if (!msg.text) return;
	if (msg.chat.id != groupId) return;
	if (spam(msg.from.id, msg.text)) return;
        if (msg.from.username.length > 20) { return; }
	cmd(msg.from.username || msg.from.first_name, 'Telegram', msg.text);
	feed(msg.from.username || msg.from.first_name, 'Telegram', msg.text);
	ircdmsg(msg.from.username || msg.from.first_name, msg.text);
	socketmsg(msg.from.username || msg.from.first_name, msg.text);
	logmsg(msg.from.username || msg.from.first_name, msg.text);
});



process.on('uncaughtException', function (er) {
	console.error(er.stack)
});
