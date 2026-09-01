export const BACKEND_ORIGIN = (process.env.REACT_APP_BACKEND_ORIGIN || 'http://localhost:5001').replace(/\/$/, '');
export const APPLICATIONS_API = `${BACKEND_ORIGIN}/api/applications`;
