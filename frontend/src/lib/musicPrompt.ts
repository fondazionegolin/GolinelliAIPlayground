/** Local musical vocabulary: deterministic recognition, with curated affinities before context ranking. */
export type MusicCategory = 'genre' | 'instrument' | 'rhythm' | 'timbre'
interface Term { label: string; aliases: string[]; tags: string[]; near: string[]; category: MusicCategory }
export interface MusicToken { from: number; to: number; text: string; category: MusicCategory; term: string }
export const musicCategories: Record<MusicCategory, string> = { genre: 'Genere', instrument: 'Strumento', rhythm: 'Ritmo', timbre: 'Timbro e atmosfera' }
const terms: Term[] = []
function group(category: MusicCategory, tags: string[], rows: string[]) {
  rows.forEach(row => {
    const [names, related = ''] = row.split('>')
    const [label, ...aliases] = names.trim().split('|')
    terms.push({ label, aliases: [label, ...aliases], tags, near: related.split(',').map(v => v.trim()).filter(Boolean), category })
  })
}
group('genre', ['jazz', 'acoustic', 'warm'], [
  'jazz>chill,soul,blues,bossa nova,swing', 'soul>jazz,blues,funk,R&B', 'blues>jazz,soul,rock', 'bossa nova|bossa>jazz,chill,soul', 'swing>jazz,blues,bossa nova',
])
group('genre', ['electronic', 'soft'], ['chill|chillout|chill out>lo-fi,ambient,soul,jazz', 'lo-fi|lofi|lo fi>chill,hip hop,jazz', 'ambient>chill,downtempo,lo-fi', 'downtempo>chill,ambient,trip hop', 'trip hop>downtempo,hip hop,chill'])
group('genre', ['electronic', 'dance'], ['house>deep house,disco,techno', 'deep house>house,chill,disco', 'techno>house,electro,trance', 'electro|elettronica|electronic>house,techno,synth pop', 'trance>techno,house,electro', 'drum and bass|drum & bass|dnb>breakbeat,techno,hip hop', 'breakbeat>drum and bass,hip hop,electro'])
group('genre', ['groove', 'warm'], ['funk>soul,disco,R&B', 'disco>funk,house,soul', 'R&B|rnb|rhythm and blues>soul,hip hop,funk', 'hip hop|hip-hop|rap>R&B,lo-fi,trip hop', 'reggae>dub,ska,soul', 'dub>reggae,trip hop,ambient', 'ska>reggae,funk,rock'])
group('genre', ['acoustic', 'strings'], ['rock>blues,indie,pop', 'indie>folk,rock,pop', 'pop>synth pop,indie,soul', 'synth pop|synth-pop>pop,electro,disco', 'folk>country,indie,acustica', 'country>folk,blues,rock', 'acustica|acoustic>folk,jazz,classica', 'classica|classical>orchestrale,cinematica,acustica', 'orchestrale|orchestral>classica,cinematica,ambient', 'cinematica|cinematic|epica|epic>orchestrale,ambient,classica', 'metal|heavy metal>rock,punk,blues', 'punk>rock,indie,metal', 'samba>bossa nova,jazz,reggae', 'tango>classica,jazz,bossa nova'])
group('instrument', ['acoustic', 'jazz', 'warm'], ['pianoforte|piano|pianoforti>piano elettrico,Rhodes,chitarra acustica', 'piano elettrico|electric piano>Rhodes,pianoforte,organo', 'Rhodes>piano elettrico,pianoforte,organo', 'contrabbasso|double bass|upright bass> basso,fretless,violoncello', 'sassofono|sax|saxophone|sassofoni>tromba,clarinetto,flauto', 'tromba|trumpet>sassofono,trombone,clarinetto', 'trombone>tromba,sassofono,corno', 'clarinetto|clarinet>sassofono,flauto,oboe', 'flauto|flute>clarinetto,oboe,sassofono', 'organo|organ>Rhodes,piano elettrico,synth'])
group('instrument', ['acoustic', 'strings'], ['chitarra|guitar|chitarre>chitarra acustica,chitarra elettrica,ukulele', 'chitarra acustica|acoustic guitar>chitarra classica,ukulele,arpa', 'chitarra classica|classical guitar>chitarra acustica,arpa,ukulele', 'chitarra elettrica|electric guitar>chitarra acustica,basso,synth', 'basso|bass|bassi>contrabbasso,fretless,synth', 'fretless|basso fretless>contrabbasso,basso,violoncello', 'violino|violin|violini>viola,violoncello,archi', 'viola>violino,violoncello,archi', 'violoncello|cello>viola,contrabbasso,archi', 'archi|strings|orchestra d’archi>violino,violoncello,arpa', 'arpa|harp>pianoforte,chitarra classica,archi', 'ukulele>chitarra acustica,chitarra classica,arpa', 'oboe>clarinetto,flauto,corno', 'corno|french horn>trombone,tromba,oboe'])
group('instrument', ['electronic', 'dance'], ['synth|sintetizzatore|sintetizzatori|synthesizer>pad,tastiere,piano elettrico', 'pad|pads> synth,archi,tastiere', 'tastiere|keyboard|keyboards>synth,piano elettrico,organo', 'drum machine|batteria elettronica>campionatore,batteria,percussioni', 'campionatore|sampler>drum machine,synth,tastiere'])
group('instrument', ['groove', 'acoustic'], ['batteria|drums|drum kit>percussioni,drum machine,bonghi', 'percussioni|percussion>bonghi,congas,batteria', 'bonghi|bongo>congas,percussioni,batteria', 'congas>bonghi,percussioni,batteria', 'vibrafono|vibraphone>marimba,xilofono,pianoforte', 'marimba>vibrafono,xilofono,percussioni', 'xilofono|xylophone>marimba,vibrafono,pianoforte'])
group('rhythm', ['groove'], ['lento|lenta|slow>moderato,rilassato', 'moderato|midtempo>lento,allegro', 'allegro|veloce|fast>moderato,vivace', 'vivace>allegro,moderato', 'sincopato|sincopata|syncopated>shuffle,terzinato,in levare', 'shuffle>terzinato,sincopato,in levare', 'terzinato|triplet>shuffle,sincopato', 'in levare|offbeat>sincopato,shuffle', 'quattro quarti|4/4>tre quarti,sei ottavi', 'tre quarti|3/4>sei ottavi,quattro quarti', 'sei ottavi|6/8>tre quarti,quattro quarti'])
group('timbre', ['warm', 'soft', 'acoustic'], ['caldo|calda|warm>morbido,avvolgente,intimo', 'morbido|morbida|soft>caldo,vellutato,delicato', 'vellutato|vellutata>morbido,caldo,avvolgente', 'avvolgente|avvolgenti>caldo,morbido,arioso', 'intimo|intima|intimate>delicato,caldo,rilassato', 'delicato|delicata|gentle>morbido,intimo,arioso', 'rilassato|rilassata|rilassante|calmo|calma|relaxing>delicato,intimo,sognante', 'sognante|dreamy>etereo,arioso,rilassato', 'etereo|eterea|ethereal>sognante,arioso,delicato', 'arioso|ariosa|airy>etereo,brillante,sognante'])
group('timbre', ['electronic', 'dance'], ['brillante|bright>cristallino,arioso,metallico', 'cristallino|cristallina>brillante,arioso,delicato', 'metallico|metallica|metallic>brillante,distorto,scuro', 'distorto|distorta|distorted>ruvido,saturo,metallico', 'ruvido|ruvida|rough>distorto,saturo,scuro', 'saturo|satura|saturated>distorto,ruvido,caldo', 'scuro|scura|dark>profondo,ruvido,malinconico', 'profondo|profonda|deep>scuro,avvolgente,caldo', 'energico|energica|energetic>incalzante,brillante,gioioso', 'incalzante|driving>energico,saturo,brillante', 'gioioso|gioiosa|allegro umore|happy>energico,brillante,sognante', 'malinconico|malinconica|melancholic>intimo,scuro,sognante'])
group('timbre', ['warm', 'acoustic'], ['acustico|acustiche|acustici>naturale,caldo,intimo', 'naturale|naturali|natural>acustico,pulito,caldo', 'pulito|pulita|clean>cristallino,naturale,brillante', 'secco|secca|dry>pulito,intimo,naturale', 'riverberato|riverberata|reverberant|reverberated>spazioso,etereo,avvolgente', 'spazioso|spaziosa|spacious>riverberato,arioso,avvolgente', 'analogico|analogica|analog>vintage,caldo,saturo', 'vintage|retrò|retro>analogico,caldo,ruvido'])
group('timbre', ['electronic', 'dance'], ['digitale|digital>elettrico,cristallino,brillante', 'elettrico|elettrica|electric>digitale,distorto,brillante'])
const normalize = (s: string) => s.toLocaleLowerCase('it-IT').normalize('NFC')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byAlias = new Map(terms.flatMap(term => term.aliases.map(alias => [normalize(alias), term] as const)))
const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:\\d{2,3}\\s*bpm|${[...byAlias.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu')
export function parseMusicPrompt(text: string): MusicToken[] {
  return [...text.matchAll(pattern)].map(match => {
    const term = byAlias.get(normalize(match[0]))
    return { from: match.index!, to: match.index! + match[0].length, text: match[0], term: term?.label || 'bpm', category: term?.category || 'rhythm' }
  })
}
export function musicSuggestions(token: MusicToken, context: MusicToken[]): string[] {
  if (token.term === 'bpm') {
    const bpm = Number.parseInt(token.text, 10)
    return [...new Set([-5, 5, -10, 10, -20, 20].map(delta => Math.max(20, Math.min(300, bpm + delta))))].filter(n => n !== bpm).map(n => `${n} bpm`)
  }
  const current = terms.find(t => t.label === token.term)
  if (!current) return []
  const genreTags = context.filter(t => t.category === 'genre').flatMap(t => terms.find(entry => entry.label === t.term)?.tags || [])
  const score = (t: Term) => (current.near.includes(t.label) ? 1000 - current.near.indexOf(t.label) * 20 : 0)
    + t.tags.filter(tag => genreTags.includes(tag)).length * 5 + t.tags.filter(tag => current.tags.includes(tag)).length
  return terms.filter(t => t.category === token.category && t !== current).sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label)).slice(0, 8).map(t => t.label)
}
export function replaceMusicToken(value: string, token: MusicToken, replacement: string): string {
  return value.slice(token.from, token.to) === token.text ? value.slice(0, token.from) + replacement + value.slice(token.to) : value
}
