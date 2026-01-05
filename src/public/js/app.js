// Main app - Two-phase flow
import { State, setState } from './state.js';
import { fetchPlan, streamBuild } from './api.js';
import { setConfig, updateTitle, updateFavicon, formatTime, notify, requestNotifications } from './ui.js';
import * as Timer from './timer.js';
import * as Form from './components/form.js';
import * as Status from './components/status.js';
import * as Results from './components/results.js';
import * as ErrorDisplay from './components/error.js';

let currentPlan = null;

function updateUI(state, message) {
  updateTitle(state);
  updateFavicon(state);

  const examplesEl = document.getElementById('examples');

  if (state === State.SEARCHING) {
    Status.show(message);
    Results.hide();
    ErrorDisplay.hide();
    if (examplesEl) examplesEl.style.display = 'none';
  } else if (state === State.DONE) {
    Status.hide();
    if (examplesEl) examplesEl.style.display = 'none';
  } else if (state === State.ERROR) {
    Status.hide();
    Results.hide();
    ErrorDisplay.show(message);
    if (examplesEl) examplesEl.style.display = 'block';
  }
}

// Phase 1: Get plan
async function handlePlan(query) {
  const { btn } = window.formElements;

  Form.disable(btn);
  setState(State.SEARCHING);
  updateUI(State.SEARCHING);
  Status.updateText('Generating plan...');
  Results.clear();
  Results.show();

  Timer.start((elapsed) => {
    Status.updateTime(formatTime(elapsed));
    updateTitle('searching', formatTime(elapsed));
  });

  try {
    const result = await fetchPlan(query);
    const elapsed = Timer.stop();

    currentPlan = result.plan;
    Results.setUsage(
      result.usage.input + result.usage.output,
      result.usage.input * 0.25/1e6 + result.usage.output * 1.25/1e6
    );
    Results.setDuration(formatTime(elapsed));
    showPlan(result.plan);
  } catch (err) {
    Timer.stop();
    setState(State.ERROR);
    updateUI(State.ERROR, err.message);
  } finally {
    Form.enable(btn);
  }
}

// Show plan with build button
function showPlan(plan) {
  Status.hide();

  if (!plan.canBuild) {
    let html = `<div class="plan-result">
      <div class="plan-header">Unable to build</div>
      <p>${plan.suggestion?.message || "We can't build this yet."}</p>`;

    if (plan.suggestion?.potentialMcps?.length) {
      html += `<div class="plan-suggestions">
        <p>MCP servers that could enable this:</p>
        <ul>`;
      for (const mcp of plan.suggestion.potentialMcps) {
        html += `<li><strong>${mcp.name}</strong> (${mcp.package})</li>`;
      }
      html += `</ul></div>`;
    }
    html += `</div>`;

    Results.setHTML(html);
    setState(State.DONE);
    updateUI(State.DONE);
    return;
  }

  const spec = plan.spec;
  const html = `<div class="plan-result">
    <div class="plan-header">Ready to build</div>
    <div class="plan-details">
      <div class="plan-row"><span class="plan-label">Agent</span><span class="plan-value">${spec.displayName}</span></div>
      <div class="plan-row"><span class="plan-label">Approach</span><span class="plan-value">${plan.approach}</span></div>
    </div>
    <button class="build-btn" id="buildBtn">Build Agent</button>
  </div>`;

  Results.setHTML(html);
  document.getElementById('buildBtn').addEventListener('click', () => handleBuild());

  setState(State.DONE);
  updateTitle('ready');
  updateFavicon('ready');
}

// Phase 2: Build
async function handleBuild() {
  if (!currentPlan?.canBuild) return;

  const buildBtn = document.getElementById('buildBtn');
  if (buildBtn) {
    buildBtn.disabled = true;
    buildBtn.textContent = 'Building...';
  }

  setState(State.SEARCHING);
  Status.show('Building...');
  Status.updateText('Creating repository...');

  Timer.start((elapsed) => {
    Status.updateTime(formatTime(elapsed));
    updateTitle('building', formatTime(elapsed));
  });

  try {
    for await (const chunk of streamBuild(currentPlan)) {
      if (chunk.type === 'status') {
        Status.updateText(chunk.message);
      } else if (chunk.type === 'result') {
        const elapsed = Timer.stop();
        Status.hide();

        Results.setHTML(`<div class="build-result">
          <div class="build-header">Agent deployed</div>
          <div class="build-links">
            <a href="${chunk.flyUrl}" target="_blank" class="build-link primary">${chunk.flyUrl}</a>
            <a href="${chunk.githubUrl}" target="_blank" class="build-link secondary">GitHub</a>
          </div>
        </div>`);

        Results.setDuration(formatTime(elapsed));
        setState(State.DONE);
        updateUI(State.DONE);
        notify('Agent deployed!');
      } else if (chunk.error) {
        throw new Error(chunk.error);
      }
    }
  } catch (err) {
    Timer.stop();
    setState(State.ERROR);
    updateUI(State.ERROR, err.message);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const config = await fetch('/config.json').then(r => r.json());

  setConfig(config);
  Form.setConfig(config);
  Status.setConfig(config);

  document.getElementById('agentName').textContent = config.name;
  document.getElementById('agentTagline').textContent = config.tagline;
  document.title = config.name;

  Status.init();
  Results.init();
  ErrorDisplay.init();

  window.formElements = Form.init(handlePlan);
  window.formElements.input.addEventListener('focus', requestNotifications, { once: true });

  const examplesEl = document.getElementById('examples');
  if (examplesEl) {
    examplesEl.addEventListener('click', (e) => {
      const card = e.target.closest('.example-card');
      if (card) {
        window.formElements.input.value = card.dataset.prompt;
        window.formElements.input.focus();
      }
    });
  }
});
