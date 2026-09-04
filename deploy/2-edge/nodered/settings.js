/**
 * Node-RED — configuración del edge IOT2050 (Greytec IDP)
 *
 * Este settings.js vive en /data (bind-mount ./nodered). Las claves no
 * definidas usan los valores por defecto de Node-RED.
 *
 * El secreto para cifrar credenciales (nodos MQTT/OPC UA) viene del .env
 * vía la variable NODE_RED_CREDENTIAL_SECRET — nunca se escribe en el repo.
 */
module.exports = {
    flowFile: 'flows.json',
    flowFilePretty: true,

    // Cifra flows_cred.json. Si cambia, las credenciales guardadas se pierden.
    credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET,

    uiPort: process.env.PORT || 1880,
    uiHost: '0.0.0.0',

    // Node-RED Dashboard del operador de campo (ADR-013): http://<host>:1880/ui
    ui: { path: 'ui' },

    logging: {
        console: { level: 'info', metrics: false, audit: false }
    },

    exportGlobalContextKeys: false,
    functionGlobalContext: {},

    editorTheme: {
        projects: { enabled: false },
        header: { title: 'Greytec Edge — IOT2050' }
    }
};
