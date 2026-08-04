const elevenlabs = require("./elevenlabs");

const providers = {
  elevenlabs,
};

function getProvider(name) {
  const provider = providers[name];
  if (!provider) throw new Error(`Proveedor de voz desconocido: ${name}`);
  return provider;
}

module.exports = { getProvider };
