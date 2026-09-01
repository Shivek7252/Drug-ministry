import { BACKEND_ORIGIN } from '../config/api';
import { authenticatedFetch, clearCsrfToken, setCsrfToken } from './http';

async function jsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  if (data.csrfToken) setCsrfToken(data.csrfToken);
  return data;
}

export async function loginSession(username, password) {
  const response = await fetch(`${BACKEND_ORIGIN}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return jsonResponse(response);
}

export async function getSession() {
  const response = await fetch(`${BACKEND_ORIGIN}/api/auth/me`, { credentials: 'include' });
  return jsonResponse(response);
}

export async function logoutSession() {
  try {
    const response = await authenticatedFetch(`${BACKEND_ORIGIN}/api/auth/logout`, { method: 'POST' });
    return await jsonResponse(response);
  } finally {
    clearCsrfToken();
  }
}
