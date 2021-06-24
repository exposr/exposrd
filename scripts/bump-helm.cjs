const YAML = require('yaml')

module.exports.readVersion = function (contents) {
  const yaml = YAML.parse(contents)
  return yaml.appVersion.slice(1)
}

module.exports.writeVersion = function (contents, version) {
  const yaml = YAML.parse(contents)
  yaml.appVersion = `v${version}`
  return YAML.stringify(yaml)
}