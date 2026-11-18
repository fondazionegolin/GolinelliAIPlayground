"""Generation, build and browser observation are separate claims, bound to the exact code."""
import hashlib
import json


def source_hash(files):
    code = sorted((str(f.get('path') or ''), str(f.get('content') or '')) for f in files if not str(f.get('path') or '').endswith('.md'))
    return hashlib.sha256(json.dumps(code, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def brief_hash(files):
    brief = sorted((str(f.get('path') or ''), str(f.get('content') or '')) for f in files if str(f.get('path') or '').lower().endswith('.md'))
    return hashlib.sha256(json.dumps(brief, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def assessment(files, issues=(), bundler_ran=False, *, gaps=(), features_checked=False):
    return {'source_hash': source_hash(files), 'brief_hash': brief_hash(files), 'generation': 'completed',
            'build': 'failed' if issues else 'passed' if bundler_ran else 'not_checked',
            'runtime': 'not_checked', 'features': 'incomplete' if gaps else 'checked' if features_checked else 'not_checked',
            'issues': [i.to_dict() if hasattr(i, 'to_dict') else i for i in issues][:20],
            'gaps': list(gaps)[:20]}


def build_status(validation):
    if validation['build'] == 'failed' or validation.get('runtime') == 'failed' or validation['features'] == 'incomplete' or (validation.get('features_required') and validation['features'] == 'not_checked'): return 'needs_review'
    return 'build_passed' if validation['build'] == 'passed' else 'generated'


def saved_artifacts(files, previous=None, supplied=None):
    # Client writes cannot manufacture a "passed" verification. Preserve a server verdict only
    # when the code is byte-identical (renaming a project or editing its brief does not change it).
    old = (previous or {}).get('validation') or {}
    validation = dict(old) if old.get('source_hash') == source_hash(files) else assessment(files)
    if validation.get('brief_hash') != brief_hash(files):
        validation.update(brief_hash=brief_hash(files), features='not_checked', gaps=[],
            features_required=any(str(f.get('path') or '').lower() == 'spec.md' and str(f.get('content') or '').strip() for f in files))
    result = {k: v for k, v in (supplied or {}).items() if k not in {'validation', 'diagnostics'}}
    result['validation'] = validation
    return result
