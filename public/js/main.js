/** Page controller: form handling, geolocation, loading states and result display. */
import { askQuestion, fetchPlan } from './api.js';
import { renderForecast, renderImpactSummary, renderOverview, renderPlanList, renderSummary } from './render.js';

const $ = (id) => document.getElementById(id);

const form = $('profile-form');
const cityInput = $('city');
const cityError = $('city-error');
const submitBtn = $('submit-btn');
const status = $('form-status');
const results = $('results');
const askForm = $('ask-form');
const askBtn = $('ask-btn');
const questionInput = $('question');
const answer = $('answer');

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Rounded (~1 km) coordinates from the browser, if the user opted in. */
let coords = null;
/** Profile used for the latest plan, reused for follow-up questions. */
let lastProfile = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function setCityError(message) {
  cityError.textContent = message;
  cityError.hidden = !message;
  if (message) cityInput.setAttribute('aria-invalid', 'true');
  else cityInput.removeAttribute('aria-invalid');
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', String(loading));
}

function readProfile() {
  const data = new FormData(form);
  const profile = {
    sensitivities: data.getAll('sensitivities'),
    commuteMode: data.get('commuteMode'),
    commuteKm: Number(data.get('commuteKm')) || 0,
    heating: data.get('heating'),
    cooking: data.get('cooking'),
    hasPurifier: data.get('hasPurifier') === 'on',
    exercisesOutdoors: data.get('exercisesOutdoors') === 'on',
  };
  const city = String(data.get('city') ?? '').trim();
  if (city) return { ...profile, city };
  if (coords) return { ...profile, ...coords };
  return null;
}

$('locate-btn').addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    setStatus('Location is not supported in this browser. Please type your city.', true);
    return;
  }
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    ({ coords: c }) => {
      coords = { latitude: Math.round(c.latitude * 100) / 100, longitude: Math.round(c.longitude * 100) / 100 };
      cityInput.value = '';
      cityInput.placeholder = 'Using your current location';
      setCityError('');
      setStatus('Location set. Now build your plan.');
    },
    () => setStatus('Could not get your location. Please type your city instead.', true),
    { timeout: 10000, maximumAge: 600000 },
  );
});

for (const chip of document.querySelectorAll('[data-city]')) {
  chip.addEventListener('click', () => {
    cityInput.value = chip.dataset.city;
    coords = null;
    setCityError('');
    cityInput.focus();
  });
}

cityInput.addEventListener('input', () => {
  if (cityInput.value.trim()) setCityError('');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const profile = readProfile();
  if (!profile) {
    setCityError('Enter a city or use your location.');
    cityInput.focus();
    return;
  }

  setCityError('');
  setLoading(submitBtn, true);
  setStatus('Checking live air quality and building your plan…');

  try {
    const data = await fetchPlan(profile);
    lastProfile = profile;
    renderOverview(data);
    renderForecast(data.air, data.plan.windows);
    renderImpactSummary(data.plan.impactSummary);
    renderPlanList('routine', data.plan.routine);
    renderPlanList('indoor', data.plan.indoor);
    renderPlanList('alternatives', data.plan.alternatives);
    renderSummary(data.summary);
    answer.textContent = '';
    results.hidden = false;
    setStatus('Your plan is ready.');
    results.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setLoading(submitBtn, false);
  }
});

$('edit-link').addEventListener('click', (event) => {
  event.preventDefault();
  const heading = $('form-title');
  heading.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  heading.focus({ preventScroll: true });
});

async function ask(question) {
  if (!lastProfile) return;
  setLoading(askBtn, true);
  answer.textContent = 'Thinking…';
  try {
    const data = await askQuestion(lastProfile, question);
    answer.textContent = data.answer.text;
  } catch (error) {
    answer.textContent = error.message;
  } finally {
    setLoading(askBtn, false);
  }
}

for (const chip of document.querySelectorAll('[data-question]')) {
  chip.addEventListener('click', () => {
    questionInput.value = chip.dataset.question;
    ask(chip.dataset.question);
  });
}

askForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (question.length < 3) {
    answer.textContent = 'Please type a question first.';
    questionInput.focus();
    return;
  }
  ask(question);
});

// Ctrl/Cmd + Enter submits a follow-up question from the textarea.
questionInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) askForm.requestSubmit();
});
