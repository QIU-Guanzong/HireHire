import packageInfo from '../package.json' with { type: 'json' };

// Keep the header and health response on the same application version.
export const APP_VERSION = packageInfo.version;
