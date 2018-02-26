# containernet

> Spin up and interact with virtual networks using
> [Containernet](https://containernet.github.io/) and Node.js

```
npm install containernet
```

This module is a fork of @mafintosh [mininet](https://github.com/mafintosh/mininet)
altered to work with [Containernet](https://containernet.github.io)

## Usage

``` js
var containernet = require('containernet')
var cn = containernet()

var s1 = cn.createSwitch()
var d1 = cn.createHost({image: 'ubuntu:trusty', cmd: '/bin/bash'})
var d2 = cn.createHost({image: 'ubuntu:trusty', cmd: '/bin/bash'})

d1.link(s1)
d2.link(s1)

cn.start(function () {
  console.log('containernet started')
  console.log(`d2 ${d2.ip} ${d2.mac}`)
  // Test connectivity
  d1.exec(`ping -c 2 ${d2.ip}`, function (err, result) {
    if (err) {
      console.log(err)
    } else {
      console.log(result)
    }
    // Stop containernet
    cn.stop()
  })
})

process.on('SIGINT', function () {
  cn.stop()
})
```

## API

#### `var cn = containernet([options])`

Create a new containernet instance. Options include

``` js
{
  clean: false,         // if true run mn -c first
  sudo: true,           // use sudo if needed 
  sock: '/tmp/mn.sock', // explictly set the .sock file used
  debug: false,         // set to true to enable debug output
}
```

If for some reason your containernet instance stops working
you probably wanna try using `clean: true`.

#### `cn.start([callback])`

Start the containernet network. Usually you call this
after defining your hosts, switches and links.

After the network has fully started `start` is emitted.

#### `cn.stop([callback])`

Stop the containernet network. You should not call
any other methods after this.

After the network has fully stopped `stop` is emitted.

#### `cn.switches`

Array of all created switches.

#### `cn.hosts`

Array of all created hosts.

#### `var sw = cn.createSwitch()`

Create a new switch

#### `sw.link(other, [options])`

Link the switch with another switch or host.
Options include:

``` js
{
  bandwidth: 10,  // use 10mbit link
  delay: '100ms', // 100ms delay
  loss: 10,       // 10% package loss
  htb: true       // use htb
}
```

#### `var host = cn.createHost([options])`

Create a new host. Options include

``` js
{
  image: 'alpine',      // docker image to use for the host 
  cmd: '/bin/bash'     // cmd to run on the newly created container 
}
```

#### `host.ip`

The IP address of the host. Populated after the network is started.

#### `host.mac`

The MAC address of the host. Populated after the network is started.

#### `host.link(other, [options])`

Link the host with another host or switch.
Takes the same options as `sw.link`.

#### `host.exec(cmd, [callback])`

Execute a command and buffer the output and return it in the callback.

## License

MIT
