/** Thin client for the AirWise JSON API. */

async function request(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON error page; handled below.
  }
  if (!response.ok) {
    const message = data?.details?.join(' ') || data?.error || `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

export const fetchPlan = (profile) => request('/api/plan', profile);
export const askQuestion = (profile, question) => request('/api/ask', { ...profile, question });
