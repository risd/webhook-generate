const { spawn } = require('child_process')
const pspawn = async (cmd, args) => {
  let stdout = ''
  let stderr = ''
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    p.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    p.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    p.on('close', (code) => {
      if (code !== 0) {
        const msg = stderr.length > 0
          ? stderr
          : stdout
        return reject(new Error(msg))
      }
      resolve(stdout)
    })
  })
}

module.exports = pspawn
