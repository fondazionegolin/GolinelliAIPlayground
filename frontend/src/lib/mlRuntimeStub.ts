import type { HeadJSON } from './imageClassifier'

export interface MlRuntimeModel {
  id: string
  name: string
  mode: 'image' | 'pose' | 'hand'
  threshold?: number
  classes: Array<{ id: string; name: string; color?: string }>
  head: HeadJSON
}

/** Ids of the models listed in a project's ml-models.md (one «id: <uuid>» per model). */
export function mlModelIdsFrom(markdown: string | undefined): string[] {
  if (!markdown) return []
  return [...new Set([...markdown.matchAll(/\bid:\s*`?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`?/gi)].map((m) => m[1].toLowerCase()))]
}

/**
 * Plain JS injected into previews (static HTML and the React bridge): defines window.GolinelliML, which lazy-loads the
 * ML runtime script from the platform origin the first time a model is loaded. No backticks / template placeholders.
 */
export function buildMlStub(models: MlRuntimeModel[], origin: string): string {
  const payload = JSON.stringify(models).replace(/</g, '\\u003c')
  return `(function(){
  if (window.GolinelliML) return;
  var base = ${JSON.stringify(origin)};
  window.__GOLIAI_ML_MODELS__ = ${payload};
  var loading = null;
  function runtime(){
    if (window.GolinelliMLRuntime) return Promise.resolve(window.GolinelliMLRuntime);
    if (loading) return loading;
    loading = new Promise(function(resolve, reject){
      var script = document.createElement('script');
      script.src = base + '/lib/goliai-ml.js';
      script.onload = function(){ window.GolinelliMLRuntime.setAssetBase(base); resolve(window.GolinelliMLRuntime); };
      script.onerror = function(){ loading = null; reject(new Error('Runtime dei modelli ML non raggiungibile.')); };
      document.head.appendChild(script);
    });
    return loading;
  }
  window.GolinelliML = {
    models: function(){ return window.__GOLIAI_ML_MODELS__.map(function(m){ return { id: m.id, name: m.name, mode: m.mode, labels: m.classes.map(function(c){ return c.name; }) }; }); },
    load: function(key){ return runtime().then(function(rt){ return rt.load(key); }); }
  };
})();`
}
