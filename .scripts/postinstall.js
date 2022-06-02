const fs = require('fs');

const gaMultisigContract = fs.readFileSync(__dirname + '/../contracts/SimpleGAMultiSig.aes', 'utf-8');
fs.writeFileSync(__dirname + '/../gaMultisigContract.aes.js', `module.exports = \`\n${gaMultisigContract.replace(/`/g, "\\`")}\`;\n`, 'utf-8');
