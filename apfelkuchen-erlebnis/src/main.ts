import './styles/main.css';
import { readViewPref, setupMotionToggle, setupStatusPanel } from './ui/chrome';

type StaticReason = 'motion' | 'webgl' | 'error';

function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const ok = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

const root = document.documentElement;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function switchView(): void {
  window.scrollTo(0, 0);
  window.location.reload();
}

async function startStaticStory(reason: StaticReason): Promise<void> {
  root.classList.remove('is-cinematic');
  root.classList.add('is-static');
  const { startStatic } = await import('./static/staticStory');
  await startStatic(reason);
}

async function boot(): Promise<void> {
  const webgl = supportsWebGL2();
  const pref = readViewPref();
  const calm = pref === 'ruhig' || (pref === null && reducedMotionQuery.matches);

  setupStatusPanel();
  setupMotionToggle(calm || !webgl, webgl, switchView);

  if (!webgl) return startStaticStory('webgl');
  if (calm) return startStaticStory('motion');

  root.classList.add('is-cinematic');
  try {
    const { startCinematic } = await import('./core/cinematic');
    await startCinematic({
      onFatal: () => {
        // e.g. the GPU dropped the WebGL context: fall back to the calm story
        startStaticStory('error').catch(console.error);
      },
    });
  } catch (error) {
    console.error('Omas Apfelkuchen: animated version failed, showing the static story instead.', error);
    await startStaticStory('error');
  }
}

// Follow a change of the system setting unless the visitor chose a view explicitly.
reducedMotionQuery.addEventListener('change', () => {
  if (readViewPref() === null) switchView();
});

boot().catch((error) => console.error(error));
