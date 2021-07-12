const YAML = require('yaml')

module.exports.readVersion = function (contents) {
  const yaml = YAML.parse(contents)
  return yaml.version
}

module.exports.writeVersion = function (contents, version) {
  const yaml = YAML.parse(contents)
  yaml.appVersion = `${version}`
  yaml.version = `${version}`
  return YAML.stringify(yaml)
}
