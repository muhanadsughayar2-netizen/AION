const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = path.join(__dirname, 'flow-premium');
const distDir = path.join(__dirname, 'flow-premium-dist');

const skipObfuscation = ['jspdf.min.js', 'marked.min.js'];

if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else if (entry.name.endsWith('.js') && !skipObfuscation.includes(entry.name)) {
            const code = fs.readFileSync(srcPath, 'utf8');
            try {
                const result = JavaScriptObfuscator.obfuscate(code, {
                    compact: true,
                    controlFlowFlattening: true,
                    controlFlowFlatteningThreshold: 0.5,
                    deadCodeInjection: true,
                    deadCodeInjectionThreshold: 0.2,
                    identifierNamesGenerator: 'hexadecimal',
                    renameGlobals: false,
                    selfDefending: false,
                    stringArray: true,
                    stringArrayEncoding: ['base64'],
                    stringArrayThreshold: 0.75,
                    transformObjectKeys: true,
                    unicodeEscapeSequence: false
                });
                fs.writeFileSync(destPath, result.getObfuscatedCode());
                console.log('Obfuscated: ' + entry.name);
            } catch (e) {
                console.log('Skipped (error): ' + entry.name + ' - ' + e.message);
                fs.copyFileSync(srcPath, destPath);
            }
        } else {
            fs.copyFileSync(srcPath, destPath);
            if (entry.name.endsWith('.js')) console.log('Copied (already minified): ' + entry.name);
        }
    }
}

copyDir(srcDir, distDir);
console.log('\nDone! Obfuscated extension ready in: flow-premium-dist/');
