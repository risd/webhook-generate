const debug = require('debug')('lib/firebase')
const { initializeApp } = require('firebase/app')
const {
  getDatabase,
  ref,
  child,
  get,
} = require('firebase/database')

let dbRef

module.exports.initializeDatabase = (config) => {
  const app = initializeApp(config)
  dbRef = ref(getDatabase(app))
  return dbRef
}

const getKey = (key, defaultValue) => {
  debug('get-key')
  return new Promise((resolve, reject) => {
    get(key)
      .then(snapshot => {
        const data = snapshot.val()
        if (data) {
          resolve(data)
        }
        else {
          resolve(defaultValue)
        }
      })
      .catch(reject)
  })
}

module.exports.getBucketData = async ({
  siteName,
  siteKey,
}) => {
  debug('get-bucket-data')
  const keyString = 'buckets/' + siteName + '/' + siteKey + '/dev'
  debug(keyString)
  const key = child(dbRef, keyString)
  return getKey(key, {})
}

module.exports.getDnsChildData = async ({ siteName }) => {
  debug('get-dns-child-data')
  const keyString = 'management/sites/' + siteName + '/dns'
  debug(keyString)
  const key = child(dbRef, keyString)
  return getKey(key, null)
}
