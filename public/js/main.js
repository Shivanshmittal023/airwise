/** Page controller: form handling, geolocation and result display. */
import { askQuestion, fetchPlan } from './api.js';
import { renderAir, renderForecast, renderPlanList, renderSummary } from './render.js';

const form = document.getElementById('profile-form');
const cityInput = document.getElementById('city');
const cityError = document.getElementById('city-error');
const locateBtn = document.getElementById('locate-btn');
const submitBtn = document.getElementById('submit-btn');
const status = document.getElementById('form-status');
const results = document.getElementById('results');
const askForm = document.getElementById('ask-form');
const askBtn = document.getElementById('ask-btn');
const questionInput = document.getElementById('question');
const answer = document.getElementById('answer');

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

locateBtn.addEventListener('click', () => {
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
  submitBtn.disabled = true;
  form.setAttribute('aria-busy', 'true');
  setStatus('Checking live air quality and building your plan…');

  try {
    const data = await fetchPlan(profile);
    lastProfile = profile;
    renderAir(data);
    renderForecast(data.air, data.plan.windows);
    renderPlanList('routine', data.plan.routine);
    renderPlanList('indoor', data.plan.indoor);
    renderPlanList('alternatives', data.plan.alternatives);
    renderSummary(data.summary);
    answer.textContent = '';
    results.hidden = false;
    setStatus('Your plan is ready.');
    results.focus();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    submitBtn.disabled = false;
    form.removeAttribute('aria-busy');
  }
});

askForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (question.length < 3) {
    answer.textContent = 'Please type a question first.';
    questionInput.focus();
    return;
  }
  if (!lastProfile) return;

  askBtn.disabled = true;
  answer.textContent = 'Thinking…';
  try {
    const data = await askQuestion(lastProfile, question);
    answer.textContent = data.answer.text;
  } catch (error) {
    answer.textContent = error.message;
  } finally {
    askBtn.disabled = false;
  }
});
