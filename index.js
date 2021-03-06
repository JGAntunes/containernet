var split = require('split2')
var through = require('through2')
var proc = require('child_process')
var util = require('util')
var fs = require('fs')
var path = require('path')
var net = require('net')
var events = require('events')
var os = require('os')
var Docker = require('dockerode')

var docker = Docker()

module.exports = Mininet

function Mininet (opts) {
  if (!(this instanceof Mininet)) return new Mininet(opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  this.hosts = []
  this.switches = []
  this.controllers = []
  this.started = false
  this.stopped = false

  this._defer = opts.defer ? [] : null
  this._queue = []
  this._python = null
  this._sock = opts.sock || path.join(os.tmpdir(), 'mn.' + Math.random() + 'sock')
  this._stdio = opts.stdio
  this._prefixStdio = opts.prefixStdio
  this._server = null
  this._args = ['python', '-i']
  this._debug = !!opts.debug
  if (opts.clean) this._args.unshift(path.join(__dirname, 'clean.sh'))
  if (process.getuid() && opts.sudo !== false) {
    this._args.unshift('sudo', '-E')
  }

  this._listen()
}

util.inherits(Mininet, events.EventEmitter)

Mininet.prototype._listen = function () {
  var self = this

  this._server = net.createServer(onsocket)
  this._server.unref()
  fs.unlink(this._sock, onready)

  function onsocket (socket) {
    socket.unref()
    socket.on('error', function () {
      socket.destroy()
    })
    socket.once('readable', function onreadable () {
      var header = socket.read(32)
      if (!header) return socket.once('readable', onreadable)
      header = header.toString().trim().split(' ')
      var host = self.hosts[Number(header[0])]
      if (!host) return socket.destroy()
      if (header[2] === 'stdio') host._onstdio(Number(header[1]), socket)
      if (header[2] === 'rpc') host._onrpc(Number(header[1]), socket)
    })
  }

  function onready () {
    if (self.stopped) return
    self._server.listen(self._sock)
  }
}

Mininet.prototype._onexit = function (code) {
  if (code === 10) {
    this.emit('error', new Error('Mininet not installed'))
  }

  if (this.started) this.emit('stop')
  this.emit('close')
}

Mininet.prototype._exec = function (cmd) {
  if (this._defer) this._defer.push(cmd)
  else this._execNow(cmd)
}

Mininet.prototype._execNow = function (cmd) {
  if (!this._python) {
    this._python = proc.spawn(this._args[0], this._args.slice(1))
    this._python.on('exit', this._onexit.bind(this))
    this._python.stderr.resume()
    if (this._debug) this._python.stderr.pipe(process.stderr)
    this._python.stdout.pipe(split()).on('data', this._parse.bind(this))
    this._python.stdin.write(trim(`
      try:
        import json
        from mininet.topo import Topo
        from mininet.net import Containernet
        from mininet.node import Controller
        from mininet.link import Link, TCLink, OVSLink
      except:
        exit(10)

      def print_host(h):
        try:
          print "ack", json.dumps({'name': h.name, 'ip': h.IP(), 'mac': h.MAC()})
        except Exception as e:
          print "err", json.dumps("host info failed: " + str(e.message))

      def net_start():
        try:
          net.start()
          result = []
          for h in net.hosts:
            result.append({'name': h.name, 'ip': h.IP(), 'mac': h.MAC()})
          print "ack", json.dumps(result)
        except Exception as e:
          print "err", json.dumps("start failed: " + str(e.message))

      net = Containernet(link=TCLink, controller=Controller)
      net.addController("c0")
    `))
  }

  this._python.stdin.write(trim(cmd))
}

Mininet.prototype.stop = function (cb) {
  if (!cb) cb = noop

  if (this.stopped || !this.started) {
    process.nextTick(cb)
    return
  }

  this.stopped = true
  this._python.stdin.write('net.stop()')
  this._python.stdin.end(cb)
  fs.unlink(this._sock, noop)
}

Mininet.prototype.start = function (cb) {
  if (!cb) cb = noop

  if (this.stopped) {
    process.nextTick(cb, new Error('Mininet stopped'))
    return
  }

  if (this.started) {
    this._queue.push(cb)
    this._exec(`print "ack"`)
    return
  }

  var self = this

  this.started = true

  if (this._defer) {
    for (var i = 0; i < this._defer.length; i++) this._execNow(this._defer[i])
    this._defer = null
  }

  this._queue.push(onstart)
  this._exec(`
    net_start()
  `)

  function onstart (err, info) {
    if (err) return cb(err)

    for (var i = 0; i < info.length; i++) {
      var inf = info[i]
      var index = Number(inf.name.slice(1)) - 1
      var host = self.hosts[index]
      host.ip = inf.ip
      host.mac = inf.mac
      host.container = docker.getContainer(host.name)
      host.emit('network')
    }

    self.emit('start')
    cb(null)
  }
}

Mininet.prototype.createController = function () {
  var controller = new Controller(this.controllers.length, this)
  this.controllers.push(controller)
  return controller
}

Mininet.prototype.createHost = function (options) {
  var host = new Host(this.hosts.length, this, options)
  this.hosts.push(host)
  return host
}

Mininet.prototype.createSwitch = function () {
  var sw = new Switch(this.switches.length, this)
  this.switches.push(sw)
  return sw
}

Mininet.prototype._parse = function (line) {
  var i = line.indexOf(' ')
  var type = line.slice(0, i)
  var data = line.slice(i + 1)

  switch (type) {
    case 'ack':
      this._queue.shift()(null, JSON.parse(data))
      break

    case 'err':
      this._queue.shift()(new Error(JSON.parse(data)))
      break

    case 'critical':
      this.emit('error', new Error(JSON.parse(data)))
      break
  }
}

function Controller (index, mn) {
  this.index = index
  this.id = 'c' + (index + 1)
  this._mn = mn
  this._mn._exec(`
    ${this.id} = net.addController("${this.id}")
  `)
}

function Switch (index, mn) {
  this.index = index
  this.id = 's' + (index + 1)
  this._mn = mn
  this._mn._exec(`
    try:
      ${this.id} = net.addSwitch("${this.id}")
    except:
      print "critical", json.dumps("add switch failed")
  `)
}

function Host (index, mn, options) {
  events.EventEmitter.call(this)
  this.index = index
  this.id = 'd' + (index + 1)
  this.name = `mn.${this.id}`
  this.ip = null
  this.mac = null
  this.processes = []
  this._opts = Object.assign({
    image: 'alpine',
    cmd: '/bin/sh'
  }, options)
  this.container = null
  this._ids = 0
  this._mn = mn
  // const network = this._opts.ip ? `ip="${this._opts.ip}", defaultRoute='${this.id}-eth0',` : ''
  const network = this._opts.ip ? `ip="${this._opts.ip}", ` : ''
  this._mn._exec(`
    try:
      ${this.id} = net.addDocker("${this.id}", dimage="${this._opts.image}", ${network} defaultRoute="${this.id}-eth0", dcmd="${this._opts.cmd}")
    except Exception as e:
      print "critical", json.dumps("add host failed: " + str(e.message))
  `)
}

util.inherits(Host, events.EventEmitter)

Host.prototype._process = function (id) {
  for (var i = 0; i < this.processes.length; i++) {
    var proc = this.processes[i]
    if (proc._id === id) return proc
  }
  return null
}

Host.prototype._onrpc = function (id, socket) {
  var self = this
  var proc = this._process(id)
  if (!proc) return

  proc.rpc = socket
  while (proc.pending.length) {
    var next = proc.pending.shift()
    proc._send(next.name, next.data, next.from)
  }

  socket.pipe(split()).on('data', function (data) {
    try {
      data = JSON.parse(data)
    } catch (err) {
      socket.destroy()
      return
    }
    if (data.to === '*') return broadcast(data)
    if (data.to) return forward(data, data.to)

    proc.emit('message', data.name, data.data)
    proc.emit('message:' + data.name, data.data)
  })

  proc.emit('rpc')

  function broadcast (data) {
    for (var i = 0; i < self._mn.hosts.length; i++) {
      var h = self._mn.hosts[i]
      for (var j = 0; j < h.processes.length; j++) {
        h.processes[j]._send(data.name, data.data, proc.id)
      }
    }
  }

  function forward (data, to) {
    var parts = to.slice(1).split('.')
    var index = parseInt(parts[0], 10) - 1
    var id = parts.length < 2 ? -1 : parseInt(parts[1], 10)
    var host = self._mn.hosts[index]
    if (!host) return
    for (var i = 0; i < host.processes.length; i++) {
      var p = host.processes[i]
      if (p._id === id || id === -1) p._send(data.name, data.data, proc.id)
    }
  }
}

Host.prototype._onstdio = function (id, socket) {
  var self = this

  var proc = this._process(id)
  if (!proc) return

  proc.stdio = socket

  if (proc.prefixStdio) {
    var p = proc.prefixStdio + ' '
    socket.pipe(split()).on('data', (data) => proc.emit('stdout', Buffer.from(p + data + os.EOL)))
  } else {
    socket.on('data', (data) => proc.emit('stdout', data))
  }

  socket.on('close', function () {
    self._onclose(proc, null)
  })
}

Host.prototype.update = function (cb) {
  if (!cb) cb = noop

  var self = this

  this._queue.push(onupdate)
  this._mn._exec(`
    print_host(${this.id})
  `)

  function onupdate (err, info) {
    if (err) return cb(err)

    self.ip = info.ip
    self.mac = info.mac

    cb(null, info)
  }
}

Host.prototype.link =
Switch.prototype.link = function (to, opts) {
  if (!opts) opts = {}

  var line = ''
  if (opts.bandwidth) opts.bw = opts.bandwidth
  if (opts.bw !== undefined) line += ', bw=' + opts.bw
  if (opts.delay !== undefined) line += ', delay=' + JSON.stringify(opts.delay)
  if (opts.loss !== undefined) line += ', loss=' + opts.loss
  if (opts.htb || opts.useHtb) line += ', use_htb=True'

  this._mn._exec(`
    try:
      net.addLink(${this.id}, ${to.id} ${line})
    except Exception as e:
      print "critical", json.dumps("add link failed: " + str(e.message))
  `)

  return to
}

Host.prototype._onclose = function (proc, err) {
  var i = this.processes.indexOf(proc)
  if (i > -1) this.processes.splice(i, 1)
  proc.killed = true
  if (err) proc.emit('error', err)
  proc.emit('close')
  proc.emit('exit')
}

Host.prototype.exec = function (cmd, cb) {
  this.container.exec({Cmd: cmd.split(' '), AttachStdout: true, AttachStderr: true, Tty: false, AttachStdin: false}, (err, exec) => {
    if (err) return cb(err)
    exec.start({}, (err, stream) => {
      if (err) return cb(err)
      const response = through()
      // Remove the control bytes from the stream beginning
      this.container.modem.demuxStream(stream, response, response)
      // No cleanup happening in demux it seems...
      stream.on('end', () => response.end())
      return cb(null, response)
    })
  })
}

Host.prototype.logs = function (opts, cb) {
  cb = cb || opts
  opts = typeof opts === 'function' ? {} : opts
  opts = Object.assign({follow: false, stdout: true, stderr: true}, opts)
  this.container.logs(opts, cb)
}

function noop () {}

function trim (s) {
  var indent = (s.match(/\n([ ]+)/m) || [])[1] || ''
  s = indent + s.trim()
  return s.split('\n')
    .map(l => l.replace(indent, ''))
    .join('\n') + '\n\n'
}
