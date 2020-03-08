const HomeMaticRegaRequest = require('./HomeMaticRegaRequest.js').HomeMaticRegaRequest
const HomeMaticRegaRequestTestDriver = require('./HomeMaticRegaRequestTestDriver.js').HomeMaticRegaRequestTestDriver
const HomeMaticAddress = require('./HomeMaticAddress.js')
const HomeMaticRPCUni = require('./HomeMaticRPCUni.js')
const HomeMaticRPCTestDriver = require('./HomeMaticRPCTestDriver.js').HomeMaticRPCTestDriver
const fs = require('fs')
const url = require('url')

class HomeMaticCCU {
  constructor (platform, isInTest) {
    this.platform = platform
    this.config = platform.config
    this.log = platform.log
    this.cache = platform.cache
    this.sendQueue = []
    this.eventaddresses = []
    this.localCache = platform.localCache
    this.timer = 0
    this.isInTest = isInTest
    this.rpcEventClients = []
    if (this.isInTest === false) {
      this.log.info('[CCUManager] Manager initialized at %s', this.config.ccu_ip)
    }
    this.isRunning = true
    this.interfaces = {}
  }

  reloadConfig () {
    this.shutDown()
    this.ccuIP = this.config.ccu_ip
    this.ccuRegaPort = this.config.ccuRegaPort
    this.ccuFetchTimeout = this.config.fetchtimeout || 120
    this.isRunning = true

    if (this.isInTest) {
      // have to switch on manual otherwise rpc will boot up after loading devices
      this.setupRPC()
    }
  }

  doCache (address, value) {
    this.cache.doCache(address, value)
  }

  getCache (address) {
    return this.cache.getValue(address)
  }

  removeCache (address) {
    return this.cache.deleteValue(address)
  }

  setSubsection (subsection) {
    this.subsection = subsection
  }

  // this is just for simplifiyng the test cases ...
  createRegaRequest (testreturn) {
    var rega
    if (this.isInTest) {
      rega = new HomeMaticRegaRequestTestDriver(this.log, this.ccuIP)
      rega.platform = this.platform
    } else {
      rega = new HomeMaticRegaRequest(this.log, this.ccuIP)
    }
    return rega
  }

  pingCCU (callback) {
    const test = this.createRegaRequest('PONG')
    test.script('Write(\'PONG\')', data => {
      if (callback) {
        callback(data)
      }
    })
  }

  setValueRega (hmadr, value, callback) {
    let rega = this.createRegaRequest()
    this.log.debug('[CCUManager] rega.setvalue %s to ', value, hmadr.address())
    rega.setValue(hmadr, value)
    if (callback !== undefined) {
      callback()
    }
  }

  setValue (hmadr, value, callback) {
    this.log.debug('[CCUManager] setValue %s to %s', value, hmadr.address())
    const rega = this.createRegaRequest()
    rega.setValue(hmadr, value, callback)
  }

  setVariable (varName, varValue, callback) {
    let rega = this.createRegaRequest()
    rega.setVariable(varName, varValue, callback)
  }

  runScript (script, callback) {
    let rega = this.createRegaRequest()
    rega.script(script, callback)
  }

  getValueRega (hmadr, callback) {
    this.log.debug('[CCUManager] getValueRega I:%s|A:%s|C:%s|D:%s', hmadr.intf, hmadr.serial, hmadr.channelId, hmadr.dpName)
    let self = this
    this.log.debug('[CCUManager] check cache %s', hmadr.address())
    let cValue = this.cache.getValue(hmadr.address())
    if (cValue) {
      if (callback) {
        callback(cValue)
      }
    } else {
      this.log.debug('[CCUManager] cache failed for  %s will transfer request to rega', hmadr.address())
      let rega = this.createRegaRequest()
      rega.getValue(hmadr, function (result) {
        self.log.debug('[CCUManager] rega result for %s is %s', hmadr.address(), result)
        self.cache.doCache(hmadr.address(), result)
        if (callback) {
          callback(result)
        }
      })
    }
  }

  getValue (hmadr, callback) {
    if (hmadr !== undefined) {
      this.log.debug('[CCUManager] getValue %s', hmadr.address())

      if (hmadr.intf === 'Variable') {
        var rega = this.createRegaRequest()
        rega.getVariable(hmadr.serial, callback)
        return
      }

      this.getValueRega(hmadr, callback)
    } else {
      this.log.warn('[CCUManager] unknow channel skipping ...')
      if (callback) {
        callback(undefined)
      }
    }
  }

  delayed (delay) {
    const timer = this.delayed[delay]
    if (timer) {
      this.log('[CCUManager] removing old command')
      clearTimeout(timer)
    }

    const self = this
    this.delayed[delay] = setTimeout(() => {
      clearTimeout(self.delayed[delay])
      self.sendPreparedRequests()
    }, delay || 100)
    this.log('[CCUManager] New Timer was set')
  }

  prepareRequest (accessory, script) {
    const self = this
    this.sendQueue.push(script)
    self.delayed(100)
  }

  sendPreparedRequests () {
    let script = 'var d'
    this.sendQueue.map(command => {
      script += command
    })
    this.sendQueue = []
    const regarequest = this.createRegaRequest()
    regarequest.script(script, data => { })
  }

  sendRequest (accessory, script, callback) {
    const regarequest = this.createRegaRequest()
    regarequest.script(script, data => {
      if (data !== undefined) {
        try {
          const json = JSON.parse(data)
          callback(json)
        } catch (err) {
          callback(undefined)
        }
      }
    })
  }

  fetchDevices () {
    let self = this
    // kill all registered events
    return new Promise((resolve, reject) => {
      this.eventaddresses = []
      var script = 'string sDeviceId;string sChannelId;boolean df = true;Write(\'{"devices":[\');foreach(sDeviceId, root.Devices().EnumIDs()){object oDevice = dom.GetObject(sDeviceId);if(oDevice){if(df) {df = false;} else { Write(\',\');}Write(\'{\');'

      script = script + self._scriptPartForElement('id', 'sDeviceId', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oDevice.Name()', 'string', ',')
      script = script + self._scriptPartForElement('address', 'oDevice.Address()', 'string', ',')
      script = script + self._scriptPartForElement('type', 'oDevice.HssType()', 'string', ',')
      script = script + 'Write(\'"channels": [\');boolean bcf = true;foreach(sChannelId, oDevice.Channels().EnumIDs()){object oChannel = dom.GetObject(sChannelId);'
      script = script + 'if(bcf) {bcf = false;} else {Write(\',\');}Write(\'{\');'
      script = script + self._scriptPartForElement('cId', 'sChannelId', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oChannel.Name()', 'string', ',')
      script = script + self._scriptPartForElement('intfId', 'oDevice.Interface()', 'number', ',')
      script = script + self._scriptPartForElement('address', 'oChannel.Address()', 'string', ',')
      script = script + self._scriptPartForElement('type', 'oChannel.HssType()', 'string', ',')
      script = script + self._scriptPartForElement('access', 'oChannel.UserAccessRights(iulOtherThanAdmin)', 'number')
      script = script + 'Write(\'}\');}Write(\']}\');}}Write(\']\');'
      script += 'var s = dom.GetObject("'
      script += this.subsection
      script += '");string cid;boolean sdf = true;if (s) {Write(\',"subsection":[\');foreach(cid, s.EnumUsedIDs()){ '
      script += ' if(sdf) {sdf = false;}'
      script += ' else { Write(\',\');}Write(cid);}Write(\']\');}'

      script += 'Write(\'}\');'

      var regarequest = this.createRegaRequest()
      regarequest.timeout = this.ccuFetchTimeout
      regarequest.script(script, data => {
        self.saveCCUDevices(data)
        resolve(data)
      })
    })
  }

  fetchInterfaces () {
    let self = this
    return new Promise((resolve, reject) => {
      var regarequest = this.createRegaRequest()
      regarequest.timeout = this.ccuFetchTimeout
      var script = 'string sifId;boolean df = true;Write(\'{"interfaces":[\');foreach(sifId, root.Interfaces().EnumIDs()){object oIf = dom.GetObject(sifId);if(df) {df = false;} else { Write(\',\');}Write(\'{\')'
      script = script + self._scriptPartForElement('id', 'sifId', 'number', ',')
      script = script + self._scriptPartForElement('name', 'oIf.Name()', 'string', ',')
      script = script + self._scriptPartForElement('type', 'oIf.Type()', 'string', ',')
      script = script + self._scriptPartForElement('typename', 'oIf.TypeName()', 'string', ',')
      script = script + self._scriptPartForElement('info', 'oIf.InterfaceInfo()', 'string', ',')
      script = script + self._scriptPartForElement('url', 'oIf.InterfaceUrl()', 'string')
      script = script + 'Write(\'}\');} Write(\']}\');'

      regarequest.script(script, strInterfaces => {
        if (strInterfaces) {
          let interfaces = JSON.parse(strInterfaces)
          interfaces.interfaces.map(oInterface => {
            self.interfaces[oInterface.id] = oInterface
          })
          resolve()
        } else {
          reject(new Error('unable to fetch Interfaces'))
        }
      })
    })
  }

  _scriptPartForElement (elementName, functionName, type, leadingComa = '') {
    if (type === 'string') {
      return 'Write(\'"' + elementName + '": "\' # ' + functionName + ' # \'"' + leadingComa + '\');'
    } else {
      return 'Write(\'"' + elementName + '": \' # ' + functionName + ' # \'' + leadingComa + '\');'
    }
  }

  saveCCUDevices (data) {
    try {
      this.log.debug('[CCUManager] CCU response on device query are %s bytes', data.length)
      // Read Json
      let json = JSON.parse(data)
      if ((json !== undefined) && (json.devices !== undefined)) {
        // Seems to be valid json
        if (this.localCache !== undefined) {
          fs.writeFile(this.localCache, data, err => {
            if (err) {
              this.log.warn('[CCUManager] Cannot cache ccu data ', err)
            }
            this.log.info('[CCUManager] will cache ccu response to %s', this.localCache)
          })
        } else {
          this.log.warn('[CCUManager] Cannot cache ccu data local cache was not set')
        }
      }
    } catch (e) {
      this.log.warn('[CCUManager] Unable to parse live ccu data. Will try cache if there is one. If you want to know what, start homebridge in debug mode -> DEBUG=* homebridge -D')
      this.log.debug('[CCUManager] JSON Error %s for Data %s', e, data)
    }
  }

  loadCachedDevices () {
    // Try to load Data
    this.log.info('[Core] ok local cache is set to %s', this.localCache)
    try {
      fs.accessSync(this.localCache, fs.F_OK)
      // Try to load Data
      let data = fs.readFileSync(this.localCache).toString()
      if (data !== undefined) {
        try {
          let json = JSON.parse(data)
          this.log.info('[Core] loaded ccu data from local cache ... WARNING: your mileage may vary')
          return json
        } catch (e) {
          this.log.warn('[Core] Unable to parse cached ccu data. giving up')
          return undefined
        }
      }
    } catch (e) {
      this.log.warn('[Core] Unable to load cached ccu data. giving up')
      return undefined
    }
  }

  shutDown () {
    if (this.isRunning === false) {
      this.log.warn('[CCUManager] called shutdown on not running manager')
      return
    }
    this.isRunning = false
    if (this.rpcClient) {
      this.rpcClient.stop()
    }
  }

  intefaceWithId (ifId) {
    return this.interfaces[ifId]
  }

  setupRPC () {
    let self = this
    this.log.debug('[CCUManager] setupRPC')
    /* ccu ports form outside are different as what is reported by the interface .. this is shit, the if should have an url for out and inside
    https://github.com/eq-3/occu/issues/106
    */
    var portChanges = { 32000: 2000, 32001: 2001, 32010: 2010, 39292: 9292 }

    if (!this.isInTest) {
      let initialPort = this.config.local_port
      if (initialPort === undefined) {
        initialPort = 9090
      }

      if (this.rpcClient) {
        this.rpcClient.shutDown()
      }

      this.rpcClient = new HomeMaticRPCUni(this.log, initialPort, this)

      Object.keys(this.interfaces).map(ifId => {
        let oInteface = self.interfaces[ifId]
        if (oInteface.inUse === true) {
          let iUrl = oInteface.url.replace('xmlrpc://', 'http://').replace('xmlrpc_bin://', 'http://')
          let oUrl = url.parse(iUrl)
          self.log.debug('[CCU] adding interface %s', oInteface.name)
          var host = oUrl.hostname
          var port = oUrl.port
          if (host === '127.0.0.1') {
            host = self.ccuIP
            port = portChanges[port]
          }
          self.log.debug('[CCU] preparing Init for %s on host %s port %s path %s', oInteface.name, host, port, oUrl.pathname)
          self.rpcClient.addInterface(oInteface.name, host, port, oUrl.pathname)
        }
      })

      this.rpcClient.init()
    } else {
      /* setup only the test service */
      this.xmlrpc = new HomeMaticRPCTestDriver(this.log, '127.0.0.1', 0, 0, this)
      this.xmlrpc.init()
    }
  }

  registeraddressForEventProcessingAtAccessory (address, accessory, aFunction) {
    if (address !== undefined) {
      var tmpAddress = address

      if (typeof address === 'string') {
        this.log.debug('[CCUManager] address is String construct a Homematic address')
        tmpAddress = new HomeMaticAddress(address)
      }

      if ((typeof address === 'object') && (address.address())) {
        this.log.debug('[CCUManager] address is a object')
      }

      if (typeof address.isValid !== 'function') {
        this.log.error('Invalid Homematic Address %s')
        throw new Error('invalid hm address object')
      } else {
        if (tmpAddress.isValid()) {
          this.log.debug('[CCUManager] adding new address %s for processing events at %s', tmpAddress.address(), accessory.name)
          if (aFunction !== undefined) {
            this.eventaddresses.push({
              address: tmpAddress.address(),
              accessory: accessory,
              function: aFunction
            })
          } else {
            this.eventaddresses.push({
              address: tmpAddress.address(),
              accessory: accessory
            })
          }
        }
      }
    } else {
      this.log.warn('[CCUManager] Address not given %s,%s,%s', tmpAddress, accessory.name, aFunction)
    }
  }

  fireEvent (intf, address, channel, datapoint, value) {
    let self = this
    if (this.eventaddresses) {
      self.log.debug('[CCUManager] fireEvent for I:%s,A:%s|C:%s|D:%s with value %s', intf, address, channel, datapoint, value)
      let evcount = 0
      this.eventaddresses.map(function (tuple) {
        let cadr = intf + '.' + address + ':' + channel + '.' + datapoint
        if (cadr === tuple.address) {
          evcount = evcount + 1
          self.log.debug('[CCUManager] event found for routing (Adre: %s) with Value:%s To Function:%s', cadr, value, typeof tuple.function)
          tuple.accessory.event(cadr, value, tuple.function)
        }
      })
    }
  }

  prepareForReload () {
    this.eventaddresses = []
  }
}

module.exports = {
  HomeMaticCCU: HomeMaticCCU
}
