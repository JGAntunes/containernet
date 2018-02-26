var containernet = require('../')
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
