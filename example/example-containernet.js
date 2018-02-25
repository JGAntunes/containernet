var mininet = require('../')
var mn = mininet()

var s1 = mn.createSwitch()
var d1 = mn.createHost({image: 'ubuntu:trusty', cmd: '/bin/bash'})
var d2 = mn.createHost({image: 'ubuntu:trusty', cmd: '/bin/bash'})

d1.link(s1)
d2.link(s1)

mn.start(function () {
  console.log('mininet started')
  console.log(`d2 ${d2.ip} ${d2.mac}`)
  // Test connectivity
  d1.exec(`ping -c 2 ${d2.ip}`, function (err, result) {
    if (err) {
      console.log(err)
    } else {
      console.log(result)
    }
    // Stop mininet
    mn.stop()
  })
})

process.on('SIGINT', function () {
  mn.stop()
})
