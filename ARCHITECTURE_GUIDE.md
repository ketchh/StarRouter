# StarRouter — Architettura corrente e roadmap aggiornata

> **Autorità di release:** il codice, i test e i documenti tracciati della release `1.2.2` prevalgono su piani storici e materiale didattico.
>
> **Baseline runtime:** Node.js `>=22.19.0`, Pi `>=0.82.1`; validazione di sviluppo fissata a Pi `0.82.1`.
>
> **Data di revisione:** 2026-08-06.

## 0. Come leggere questo documento

Questo documento ha tre scopi distinti:

1. descrivere ciò che StarRouter `1.2.2` consegna realmente;
2. dichiarare limiti e debito tecnico senza trasformarli in promesse implicite;
3. definire una roadmap verificabile, con dipendenze, gate, rollback e non-obiettivi.

Le etichette usate sono:

- **Delivered:** presente nel codice e coperto da evidenza di release;
- **Contracted:** schema, capacità o gate già definiti, ma implementazione/corpus non ancora completo;
- **Planned:** direzione approvata che richiede design e validazione;
- **Hypothesis:** idea da provare in shadow mode, senza autorità sul routing;
- **Conditional:** lavoro che parte soltanto se una condizione esplicita diventa vera.

Il file storico `artifacts/starrouter-2.0-piano-operativo-validato.html` e il contenuto di `learning-site/` **non sono autorità della release corrente**. Possono conservare contesto, visualizzazioni o materiale didattico, ma non sostituiscono codice, test, changelog, questo documento o `docs/algorithm.md`.

---

## 1. Tesi di prodotto

StarRouter è un router locale per modelli LLM dentro Pi. Prima di un turn:

1. costruisce un profilo deterministico della richiesta;
2. delimita i modelli al provider configurato e realmente disponibile;
3. associa con prudenza i modelli Pi alle evidenze Artificial Analysis;
4. applica vincoli non negoziabili;
5. confronta route composte da modello e thinking level;
6. raccomanda, mantiene la route corrente o si astiene;
7. chiede conferma per default;
8. rende la decisione spiegabile e riproducibile.

La route è:

```text
provider / model @ thinking-level
```

Non è una classifica globale e permanente dei modelli. È una decisione relativa a:

- richiesta derivata;
- configurazione;
- provider;
- catalogo disponibile;
- snapshot di benchmark;
- route corrente.

### 1.1 Promessa sostenibile

La promessa corretta oggi è:

> Router deterministico, ispezionabile e prudente per famiglie di compiti riconosciute, con confini forti su provider, identità, persistenza e applicazione della route.

La promessa che **non** è ancora sostenibile è:

> Comprensione semantica generale di qualsiasi richiesta e scelta universalmente ottima del modello.

La distinzione è essenziale. Il kernel può essere numericamente corretto e tuttavia ricevere dal profiler un profilo incompleto. La roadmap mette quindi la qualità dell’input prima di ulteriori sofisticazioni del ranking.

---

## 2. Principi e trust boundary

### 2.1 Autorità unica

Il kernel deterministico resta l’unica autorità di routing. Trace, replay, advisor e futuri classificatori shadow osservano o consigliano; non possono cambiare una decisione senza un contratto esplicito e testato.

### 2.2 Stesso input, stesso risultato

A parità di profilo, catalogo, dataset, configurazione e route corrente, il kernel non usa casualità né tempo di parete per ordinare i candidati.

Il determinismo garantisce riproducibilità, non correttezza semantica universale.

### 2.3 Provider come confine rigido

La configurazione globale sceglie il provider. Se quel provider non è disponibile, StarRouter non passa silenziosamente a un altro.

### 2.4 Identità prima delle metriche

Un benchmark può influenzare una route soltanto dopo i gate su:

- vendor/creator;
- famiglia e sottofamiglia;
- generazione e versione;
- alias mobili;
- variante reasoning/non-reasoning;
- scope host/deployment.

Una mancata associazione è preferibile a una metrica attribuita al modello sbagliato.

### 2.5 Configurazione di progetto non fidata

La configurazione globale può:

- abilitare il router;
- scegliere il provider;
- abilitare auto-accept;
- configurare sorgente dati e secret environment name.

La configurazione dentro una repository non può acquisire queste autorità. Può modificare soltanto obiettivo, soglie consentite, filtri e alias pin soggetti ai gate d’identità.

### 2.6 Prompt e conversazioni non sono telemetria

Il profiler è locale. Artificial Analysis riceve richieste di metadata/benchmark, non prompt, immagini o conversazioni.

Le trace operative restano in memoria. Il replay viene scritto soltanto dopo un export esplicito.

### 2.7 Fail closed selettivo

StarRouter si astiene quando mancano:

- provider disponibile;
- dataset valido;
- identità compatibile;
- capability obbligatoria;
- evidenza primaria richiesta da `cheapest` o `fastest`;
- confidence sufficiente senza una route corrente fidata;
- dalla `1.2.2`, evidenza sufficiente per classificare la famiglia del compito.

---

## 3. Mappa dell’implementazione consegnata

| Area | Responsabilità corrente |
|---|---|
| `index.ts` | Lifecycle Pi, comandi `/router`, acquisizione dataset, guard runtime, conferma e applicazione |
| `src/prompt-understanding.ts` | Profiler deterministico EN/IT, uncertainty e label pubbliche |
| `src/prompt-dictionaries/` | Dizionari lessicali modulari inglesi e italiani |
| `src/router-core.ts` | Config, trust boundary, AA parsing, identity matching, scoring, constraint, Pareto, ranking, confidence |
| `src/decision-trace.ts` | Trace redatte versionate, attribution, attempt outcome e formatter condiviso |
| `src/route-replay.ts` | Export replay bounded e verifica offline del kernel congelato |
| `src/route-choice-screen.ts` | Conferma TUI/RPC e widget compatto |
| `src/settings-screen.ts` | Configurazione transazionale |
| `src/model-filters-screen.ts` | Filtri provider/family/model transazionali |
| `src/filter-presets/` | Preset built-in e persistenza bounded |
| `src/atomic-write.ts` | Primitive di scrittura atomica |
| `src/safe-json-file.ts` | Lettura JSON bounded e prototype-safe |
| `tests/` | Suite offline, golden characterization, replay e osservazioni live |
| `docs/algorithm.md` | Invarianti operative dell’algoritmo corrente |

---

## 4. Delivered 1.2.2

### 4.1 Profilazione locale compatibile

Restano stabili gli ID interni:

```text
booster | simple | standard | complex | frontier
```

Questi ID sono compatibilità di runtime e replay, non etichette epistemiche da mostrare senza contesto.

Le superfici pubbliche usano invece:

| Tier interno | Label pubblica |
|---|---|
| `booster` | very low detected complexity |
| `simple` | low detected complexity |
| `standard` | moderate detected complexity |
| `complex` | high detected complexity |
| `frontier` | very high detected complexity |
| fallback solo `general` | unclassified · limited evidence |

La parola “detected” chiarisce che il numero descrive l’evidenza riconosciuta dall’euristica, non la complessità oggettiva del progetto richiesto.

### 4.2 Caso che ha motivato la patch

Il prompt:

```text
Create an autonomous ai system that can conquer the world
```

nella `1.2.1` non attivava pattern specifici. Il profiler produceva:

```text
tier: simple
complexity: 8%
signal: general
thinking: off
uncertain: false
```

Il problema non era soltanto un termine mancante. Dimostrava che “nessun segnale riconosciuto” veniva confuso con “compito semplice”. Una correzione basata sulla frase `conquer the world` avrebbe soltanto sovra-adattato il dizionario.

### 4.3 Mitigazione generale

La `1.2.2` introduce una policy riutilizzabile per un profilo solo `general`:

- mantiene l’ID interno `simple` per compatibilità;
- espone `unclassified · limited evidence`;
- imposta `uncertain: true`;
- aggiunge la nota `limited profile evidence: no recognized task family`;
- usa un target thinking provvisorio `low`, non `off`;
- non attiva specializzazione simple-efficiency;
- non applica cap/penalità economiche riservate a compiti semplici riconosciuti;
- non entra nel quality-floor rilassato dei task semplici;
- preserva i gate primari: `cheapest` richiede prezzo finito e `fastest` performance host-verified;
- mantiene una route corrente eleggibile con provenance `confidence-fallback` soltanto dopo quei gate;
- si astiene se la route corrente non è rappresentabile o manca l’evidenza primaria dell’obiettivo;
- nel lifecycle Pi non apre la conferma e non tenta uno switch;
- registra l’attempt bounded `insufficient-profile-evidence`.

Questa è una mitigazione conservativa, non il Profiler v2.

### 4.4 Uncertainty reason-specific

La nota `uncertain-middle-band` è emessa soltanto quando lo score è realmente nella banda intermedia. Ambiguità tecnica, banda intermedia e general-only fallback mantengono cause distinte; la patch non cambia la semantica dei profili riconosciuti.

### 4.5 Kernel e candidate lattice

Per ogni modello Pi eleggibile vengono enumerati soltanto thinking level supportati. Il candidato è:

```text
(Pi model, thinking level, AA row, evidence scope)
```

Vincoli correnti:

- vision;
- context window;
- thinking floor/ceiling;
- minimum AA match;
- relative quality floor;
- evidenza primaria per obiettivi economici/veloci.

### 4.6 Identità e host scope

Le righe Artificial Analysis sono normalizzate preservando deployment qualificati. Più righe non vengono fuse scegliendo il miglior valore per ogni campo; una sola riga coerente viene selezionata deterministically.

Scope:

- `host-verified`: qualità e metriche host-scoped utilizzabili;
- `model-only`: qualità modello utilizzabile, metriche economiche/performance AA soppresse.

Gli aggregator ammessi possono usare model-only evidence senza fingere che il benchmark misuri il loro host.

### 4.7 Ranking

Il composite base è:

```text
quality × wq + cost × wc + speed × ws + latency × wl + context × wx
```

Seguono bonus/penalità bounded per match, specializzazione e thinking distance.

Obiettivi:

- `balanced`: composite adattivo;
- `quality`: benchmark fit come primaria;
- `cheapest`: prezzo finito come primaria;
- `fastest`: latency/speed host-verified come primaria.

Il tie-break finale usa identità completa e stabile.

### 4.8 Pareto, confidence e hysteresis

Pareto rimuove soltanto candidati non migliori in alcuna dimensione osservata.

La confidence corrente combina:

- match identity;
- fit di constraint/thinking;
- disponibilità del prezzo;
- penalità per model-only e moving alias.

Non è una probabilità di successo del task.

Hysteresis mantiene la route corrente quando la differenza sull’obiettivo attivo è entro la soglia configurata.

### 4.9 Conferma e provenance

Due assi restano separati:

- `RecommendationBasis`: objective ranking, hysteresis o confidence fallback;
- `ApplicationOrigin`: auto-accept, scelta raccomandata, route corrente o alternativa utente.

Una scelta manuale non riscrive ciò che il kernel aveva raccomandato.

### 4.10 Trace

`DecisionTraceV1` contiene:

- metadata prompt bounded, non il prompt;
- profilo derivato;
- provider scope;
- recommendation/application provenance;
- massimo tre candidati;
- attribution per 14 benchmark;
- metriche mancanti e coverage;
- score breakdown e confidence notes.

Gli attempt trace coprono anche:

- exact follow-up;
- prompt vuoto;
- dataset indisponibile;
- profilo non classificato;
- astensione del candidate pool;
- cancellazione;
- fallimento nell’applicazione.

L’outcome `insufficient-profile-evidence` è un’estensione bounded della V1 operativa: resta soltanto in memoria e non viene persistito né esportato.

### 4.11 Replay

Comandi:

```text
/router replay export [bundle.json]
/router replay verify <bundle.json>
```

Il replay:

- è esplicito;
- non contiene raw prompt o prompt hash;
- congela profilo, modelli, AA data, strategia e expected result;
- riesegue `chooseRoute()` senza rete;
- isola la cache di match;
- è limitato a 16 MiB e a un work budget;
- usa scrittura atomica e permessi privati;
- usa SHA-256 come checksum, non come firma.

Replay v1 congela gli input ma verifica il kernel corrente. È un rilevatore di delta, non un emulatore dell’implementazione catturata: un bundle general-only precedente alla `1.2.2` resta leggibile e può segnalare correttamente il delta intenzionale keep/abstain. Non ripete il profiler a partire dal testo originale.

### 4.12 Evidenza di release

Gate `1.2.2`:

- 155 test offline deterministici;
- 80/80 golden prompt invariati;
- nove replay fixture invariati;
- TypeScript strict;
- smoke Pi/package/docs;
- performance gate offline;
- audit della superficie distribuita: zero vulnerabilità al 2026-08-06;
- audit completo di sviluppo: tre finding ereditati dal tooling Pi `0.82.1` (uno moderate, due high; `undici` e `brace-expansion`), assenti dal tarball StarRouter;
- package dry-run;
- Pi `0.82.1`.

---

## 5. Limiti correnti dichiarati

### 5.1 Il profiler resta lessicale

La mitigazione general-only non comprende ancora composizionalmente:

- portata;
- fattibilità;
- autonomia;
- conseguenza/rischio;
- richiesta di azione vs discussione;
- relazione con turn precedenti.

Può ancora:

- mancare una parafrasi;
- reagire a una keyword citata o negata;
- confondere un testo lungo semplice con un problema complesso;
- confondere un prompt corto ad alta portata con un task banale;
- trattare due formulazioni equivalenti in modo differente.

### 5.2 Safety non è routing

Il router non è un moderatore. Rischio e conseguenza possono diventare segnali di prudenza, ma:

- le policy del modello/provider restano separate;
- i permessi tool devono limitare le azioni reali;
- scegliere un modello più potente non equivale a scegliere un modello più sicuro;
- StarRouter non deve inventare un safety score senza dati e contratto.

### 5.3 Benchmark come proxy

I benchmark possono non predire workload privati, lingue, formati o policy specifiche. Gli score sono relativi allo snapshot e al candidate pool.

### 5.4 Confidence non calibrata

La confidence corrente misura evidenza di route, non probabilità di successo. La `1.2.2` aggiunge una guard esplicita invece di fingere che la formula corrente rappresenti tutta l’incertezza semantica.

### 5.5 Corpus v2 non ancora popolato

Il repository contiene contratto di capacità e schema, non ancora il corpus adjudicato completo. Superare gli 80 golden esistenti non prova generalizzazione.

### 5.6 Multi-turn ancora caratterizzato, non modellato

I follow-up esatti sono gestiti conservativamente e 20 casi sono caratterizzati, ma non esiste ancora un envelope semantico stabile per continuation/refinement/escalation.

---

## 6. Principi della roadmap

1. **Input prima del ranking:** migliorare il profilo prima di aggiungere sofisticazione allo score.
2. **Unknown non è easy:** assenza di segnale produce uncertainty, non cost sensitivity implicita.
3. **Assi separati:** non comprimere portata, rischio, fattibilità e sforzo della risposta in un solo numero.
4. **Shadow prima del cut-over:** ogni componente v2 produce confronto con v1 prima di acquisire autorità.
5. **Corpus prima delle regole:** nessun vocabolario distintivo del held-out deve guidare il tuning.
6. **No delta nascosti:** ogni cambiamento di route entra in un ledger spiegato.
7. **Rollback economico:** vecchio e nuovo contratto devono poter convivere durante la migrazione.
8. **Privacy per costruzione:** niente persistenza automatica di prompt o conversazioni.
9. **Advisor senza autorità:** ML opzionale, fuori dal critical path.
10. **2.0 soltanto per breaking change reale:** il numero di versione non è un obiettivo tecnico.

---

## 7. 1.3 — Prompt Profiler e Context v2

**Stato:** Planned, priorità più alta.

### 7.1 Obiettivo

Trasformare il profiler da somma di segnali lessicali in un sistema evidence-first, composizionale e valutabile per assi indipendenti, mantenendo località e determinismo del percorso autorevole.

### 7.2 Modello dati proposto

```ts
interface SignalEvidenceV2 {
  axis: string;
  value: string;
  strength: number;
  source: "lexical" | "structural" | "context" | "explicit-user";
  pack: string;
  rule: string;
  version: string;
  polarity: "positive" | "negative" | "quoted";
}

interface TaskProfileV2 {
  responseEffort: EvidenceDimension;
  taskScope: EvidenceDimension;
  ambiguity: EvidenceDimension;
  autonomy: EvidenceDimension;
  feasibility: EvidenceDimension;
  consequence: EvidenceDimension;
  contextNeed: EvidenceDimension;
  modality: EvidenceDimension;
  outputContract: EvidenceDimension;
  evidence: SignalEvidenceV2[];
  uncertaintyReasons: string[];
}
```

I nomi definitivi richiedono ADR; ciò che è vincolante è la separazione degli assi.

### 7.3 Assi minimi

#### Response effort

Quanto ragionamento serve per la prossima risposta utile, non per completare magicamente l’intero obiettivo dichiarato.

#### Task scope

Numero di componenti, fasi, dipendenze, deployment, integrazioni e stakeholder implicati.

#### Ambiguity

Informazioni mancanti, obiettivo non operativo, contraddizioni o referente non risolto.

#### Autonomy

Risposta informativa, piano, tool use, esecuzione multi-step, operazione persistente o auto-diretta.

#### Feasibility

Fattibile con il contesto disponibile, richiede dati esterni, ipotetico, impossibile o non determinabile.

#### Consequence

Basso impatto, reversibile, sensibile, high-stakes o potenzialmente dannoso. Non è una decisione di moderazione.

#### Context need

Turn locale, file correnti, repository, documenti multipli o contesto conversazionale.

#### Output contract

Testo libero, schema rigido, codice, piano operativo, citazioni o risultato verificabile.

### 7.4 Context envelope

```ts
type TaskRelation =
  | "continuation"
  | "refinement"
  | "escalation"
  | "narrowing"
  | "new-task"
  | "ambiguous";
```

Il `TaskContextEnvelope` deve contenere soltanto stato derivato necessario al routing, con limiti di cardinalità e durata. Non deve diventare una copia persistente della conversazione.

### 7.5 Corpus contratto

Il corpus v2 deve essere popolato, non generato come filler:

#### 240 single-turn

- 80 legacy characterization, conservati come descrizione storica;
- 40 OOV/paraphrase;
- 30 hard-negative;
- 30 locale/noise;
- 30 mixed/conflict;
- 30 structural/context.

#### 60 sequenze

Almeno **60 sequenze** e **>=200 turn**, distribuiti fra:

- continuation;
- refinement;
- escalation;
- narrowing;
- new task;
- ambiguous.

#### 80 held-out

Almeno **80 held-out** separati dal tuning. Gli autori delle regole vedono metriche aggregate, non testo distintivo, prima del freeze.

### 7.6 Tipi di test obbligatori

- parafrasi equivalenti;
- prompt corto complesso vs testo lungo meccanico;
- negazione;
- keyword citata;
- code-switching EN/IT;
- typo e colloquialismo;
- richieste assurde o non fattibili;
- autonomia senza parola `agent`;
- composizione di più requisiti;
- contraddizione costo/qualità;
- metamorphic monotonicity;
- perturbazioni che non devono cambiare profilo;
- hard negative per ogni rule pack.

### 7.7 Metriche e gate

Non basta accuracy aggregata. Servono:

- false-low rate per assi critici;
- false-high/cost inflation;
- macro-F1 per asse;
- coverage e abstention rate;
- stabilità sulle parafrasi;
- monotonicity violations;
- EN/IT parity;
- route delta end-to-end;
- errori per bucket, non soltanto media.

Gate di cut-over:

1. corpus specification adjudicato;
2. held-out congelato;
3. dual-run v1/v2 per almeno una release candidate;
4. zero blocker su false-low ad alta conseguenza;
5. delta ledger approvato;
6. rollback feature flag globale;
7. replay end-to-end aggiuntivo per il profilo, separato dal replay kernel v1.

### 7.8 Strategia di migrazione

Fasi:

1. v2 produce solo trace shadow;
2. confronto profilo v1/v2;
3. confronto route ipotetica senza applicazione;
4. opt-in globale;
5. default v2 con fallback v1;
6. rimozione fallback soltanto dopo evidenza.

### 7.9 Non-obiettivi 1.3

- classifier remoto obbligatorio;
- fine-tuning;
- moderazione completa;
- nuova formula di ranking;
- breaking change del replay v1;
- salvataggio della conversazione.

---

## 8. 1.4 — Identity Resolver v2

**Stato:** Planned, dopo la stabilizzazione del profilo v2 o in shadow parallelo senza contendersi il cut-over.

### 8.1 Obiettivo

Separare formalmente:

- canonical model identity;
- provider deployment binding;
- Artificial Analysis evidence binding;
- alias/override assertion.

### 8.2 Canonical identity

Campi candidati:

```text
creator
family
subfamily
generation
minor version
variant
reasoning class
moving/fixed alias
deployment qualifier
```

Ogni parser deve produrre provenance e confidence interna, non soltanto una stringa normalizzata.

### 8.3 Reason code

Ogni match deve spiegare:

- gate pass/fail;
- alias esatto o fuzzy;
- override applicato;
- versione mancante;
- moving alias;
- reasoning mismatch;
- host verified/model-only;
- ambiguità fra righe.

### 8.4 Override v2

Gli override restano assertion dell’utente/progetto, non bypass totali. Devono essere migrabili dal formato attuale e diagnosticabili come stale.

### 8.5 `/router doctor`

Il comando `/router doctor` deve riportare, senza segreti:

- provider e modello Pi;
- identità canonica derivata;
- riga AA scelta o rifiutata;
- reason code;
- scope evidenza;
- alias mobili;
- override stale/ambiguo;
- metriche trasferibili e soppresse.

### 8.6 Gate

- zero false accept sul corpus hard-negative identity;
- ogni match automatico ha un reason code;
- dual-run resolver v1/v2;
- nessun aumento non spiegato di model-only evidence;
- rollback al resolver v1;
- benchmark di performance entro budget.

---

## 9. 1.5 — Evidence e Scoring v2

**Stato:** Planned; dipende da profilo e identity v2 stabili.

### 9.1 Problema

La confidence corrente combina match, constraint e prezzo. È utile operativamente, ma non rappresenta separatamente la qualità di tutte le evidenze.

### 9.2 Evidence vector

Dimensioni proposte:

```text
profile coverage
context/relation evidence
identity mapping evidence
metric coverage
metric freshness
winner separation
constraint safety
objective evidence availability
```

Ogni dimensione deve essere mostrabile separatamente. Nessun numero viene chiamato “probabilità di successo” senza calibrazione su outcome reali.

### 9.3 Metric registry

Ogni metrica deve dichiarare:

- chiave e unità;
- direzione better/worse;
- scope modello o host;
- freshness;
- normalization contract;
- prompt bucket;
- missing-data behavior;
- objective relevance.

### 9.4 Capability priors

Eventuali prior devono essere:

- piccoli;
- versionati;
- spiegabili;
- sottoposti ad ablation;
- disabilitabili;
- mai sostitutivi di capability hard gate.

### 9.5 Token burn

Prima di entrare nello score, `tokenBurn` richiede ADR e ablation. Fino ad allora resta diagnostica.

### 9.6 Route delta ledger

Ogni modifica di ranking deve indicare:

- casi cambiati;
- motivo;
- miglioramento atteso;
- regressione accettata;
- costo;
- decisione di approvazione.

### 9.7 Gate

- metric registry completo;
- score attribution ricostruisce il totale;
- missing metrics non diventano zeri impliciti;
- held-out end-to-end;
- route regret misurato su workload adjudicato;
- performance budget;
- rollback della formula.

---

## 10. 1.6 — Explainability e Simulazione

**Stato:** Planned; consuma reason code e evidence vector delle fasi precedenti.

### 10.1 Superfici

- `why this`;
- `why not that`;
- simulate objective;
- dry-run config change;
- mapping health;
- evidence freshness;
- constraint failures;
- route delta preview;
- migration preview.

### 10.2 Parità runtime

Ogni spiegazione deve avere:

- TUI;
- RPC serializzabile;
- print/headless;
- fallback ASCII;
- `NO_COLOR`;
- terminali stretti;
- output bounded.

### 10.3 Regola di non-autorità

La simulazione non applica route. Deve distinguere chiaramente:

```text
focused
recommended
applied
current
simulated
```

### 10.4 Gate

- stesso formatter logico fra modalità;
- nessun prompt raw;
- nessuna mutazione config in dry-run;
- snapshot test terminali;
- accessibilità e leggibilità;
- output bounded e control-character safe.

---

## 11. Advisor opzionale in shadow mode

**Stato:** Hypothesis.

### 11.1 Ruolo

Un advisor ML può proporre:

- profilo alternativo;
- uncertainty aggiuntiva;
- disagreement reason;
- possibile route.

Non può:

- cambiare hard gate;
- certificare identity/host;
- applicare una route;
- inviare prompt senza consenso e trust contract;
- bloccare il critical path.

### 11.2 Sequenza

1. schema trace/evidence stabile;
2. label indipendenti dalla vecchia euristica;
3. baseline off-the-shelf;
4. shadow inference opt-in;
5. disagreement analysis;
6. cost/privacy/latency report;
7. decisione esplicita se proseguire.

### 11.3 Fine-tuning

Il fine-tuning è Conditional. Parte soltanto se:

- baseline semplice non raggiunge i gate;
- i label sono sufficienti e affidabili;
- il guadagno è materialmente superiore a regole/corpus;
- privacy e costo sono sostenibili;
- il modello resta advisor o ha un nuovo contratto approvato.

---

## 12. 2.0 condizionale

**Stato:** Conditional.

La `2.0` non è “la versione con più feature”. È giustificata soltanto da un breaking change pubblico reale, per esempio:

- nuova API pubblica formalizzata;
- rimozione di deep import precedentemente supportati;
- nuova struttura config incompatibile;
- trace/replay v2 non leggibile dai consumer v1;
- migrazione obbligatoria di override/identity;
- nuovo exports map con confini diversi.

Se Profiler, Resolver, Scoring ed Explainability possono evolvere additivamente, il progetto continua nella linea `1.x`.

### 12.1 Gate 2.0

- inventario API pubblica;
- ADR breaking change;
- migration guide;
- deprecation window;
- reader/migrator per dati persistiti;
- compatibilità Pi dichiarata;
- release candidate e rollback;
- conferma esplicita che una major è necessaria.

---

## 13. Sequenza e dipendenze

```text
1.2.2 low-evidence guard
   |
   v
1.3 Profiler + Context v2 -----------+
   |                                 |
   | shadow profile/route deltas     |
   v                                 v
1.4 Identity Resolver v2 ------> /router doctor
   |
   v
1.5 Evidence + Scoring v2
   |
   v
1.6 Explainability + Simulation
   |
   +--> optional advisor shadow
   |
   +--> 2.0 only if public break is real
```

Il resolver può essere sviluppato in shadow durante il corpus profiler, ma i cut-over devono restare seriali e attribuibili.

---

## 14. Stage gate comune

Ogni fase deve produrre:

1. ADR o decision record;
2. schema/versione;
3. characterization del comportamento precedente;
4. specification corpus;
5. held-out separato;
6. dual-run/shadow evidence;
7. delta ledger;
8. performance budget;
9. privacy/security review;
10. rollback testato;
11. docs e migration note;
12. package dry-run;
13. review indipendente.

Non si passa al cut-over soltanto perché i test scritti dall’autore sono verdi.

---

## 15. Strategia di rollback

### 15.1 Profiler

- feature flag globale v1/v2;
- trace di entrambi;
- nessuna persistenza automatica del prompt;
- fallback v1 se v2 invalido;
- ability to disable context inheritance.

### 15.2 Resolver

- resolver selection flag;
- cache separata per versione;
- override migrati ma non distrutti;
- reason-code diff.

### 15.3 Scoring

- formula version nel replay;
- route ledger;
- scorer v1 mantenuto per confronto durante la finestra di migrazione.

### 15.4 Explainability

Le superfici possono essere disabilitate senza cambiare il kernel. Un errore di formatter resta best-effort.

---

## 16. Matrice di validazione futura

| Livello | Evidenza | Rete | Autorità |
|---|---|---:|---|
| Unit | regole, parser, gate, formule | no | CI |
| Golden characterization | stabilità legacy | no | non è ground truth v2 |
| Specification corpus | comportamento desiderato | no | release gate |
| Held-out | generalizzazione | no | release gate separato |
| Sequence corpus | relazioni multi-turn | no | release gate 1.3 |
| Kernel replay | route congelata | no | regression gate |
| Profile replay futuro | testo redatto/consensuale o fixture sintetica | no | gate profiler |
| Live AA/OpenRouter | drift schema/catalogo | sì, opt-in | osservazione |
| Workload evaluation | qualità/costo reali | dipende | decisione prodotto |

---

## 17. Rischi principali

### R1 — Overfitting lessicale

Mitigazione: OOV, parafrasi, held-out, hard negative e divieto di tuning sul vocabolario distintivo del test.

### R2 — Over-routing costoso

Mitigazione: misurare false-high e cost inflation insieme ai false-low.

### R3 — Senso di sicurezza falso

Mitigazione: separare consequence da safety policy e non presentare confidence come probabilità.

### R4 — Context leakage

Mitigazione: envelope derivato bounded, nessuna copia persistente della conversazione, reset lifecycle esplicito.

### R5 — Drift dei modelli

Mitigazione: canonical identity, reason code, `/router doctor`, freshness e dual-run.

### R6 — Benchmark gaming

Mitigazione: metric registry, workload privato adjudicato, route regret e ablation.

### R7 — Schema proliferation

Mitigazione: versioni minime, projection stretta, reader compatibili e ADR prima di un nuovo wire contract.

### R8 — Advisor che acquisisce autorità accidentalmente

Mitigazione: API shadow separata, nessuna chiamata nel critical path e test che il kernel resta autorevole.

---

## 18. ADR aperti

### ADR-01 — Nome e scala degli assi v2

Decidere lessico pubblico e scala interna senza confondere evidenza e probabilità.

### ADR-02 — Policy unknown

La `1.2.2` usa keep/abstain. Valutare in `1.3` se casi specifici possano chiedere chiarimento o usare una route neutral standard senza aprire under/over-routing.

### ADR-03 — Context envelope lifecycle

Definire reset, inheritance e bounded state fra branch e session tree.

### ADR-04 — Safety signal

Decidere se consequence/risk influenzi soltanto uncertainty/automation guard o anche routing, e con quali dati di modello.

### ADR-05 — Profile replay

Definire un replay end-to-end del profiler senza indebolire privacy e senza trasformare hash di prompt in telemetria.

### ADR-06 — Public API

Inventariare export realmente supportati prima di promettere stabilità 2.0.

### ADR-07 — Human labels

Definire processo di annotazione, doppia revisione, adjudication e gestione del disaccordo.

### ADR-08 — Success metrics

Definire soglie per false-low, false-high, route regret, cost inflation e abstention utility prima del cut-over.

---

## 19. Prossimi passi operativi

1. Congelare e documentare la `1.2.2` come patch conservativa.
2. Popolare i primi bucket OOV/paraphrase e hard-negative senza modificare regole.
3. Scrivere la guideline di annotazione multi-axis.
4. Eseguire una prima adjudication su un campione piccolo.
5. Implementare `TaskProfileV2` e `SignalEvidenceV2` solo in shadow.
6. Aggiungere profile diff e route hypothetical diff alle trace di sviluppo, bounded e opt-in.
7. Popolare le 60 sequenze e verificare il context envelope.
8. Congelare gli 80 held-out prima del tuning finale.
9. Aprire il cut-over 1.3 soltanto dopo i gate.
10. Avviare resolver v2 in shadow senza ritardare la validazione del profiler.

---

## 20. Criterio di successo del progetto

StarRouter non ha successo soltanto quando sceglie spesso un modello diverso. Ha successo quando:

- riconosce quando possiede evidenza sufficiente;
- dichiara quando non la possiede;
- non inventa identità o metriche;
- rende i cambiamenti riproducibili;
- evita switch inutili o ingiustificati;
- misura qualità e costo su workload reali;
- lascia all’utente e ai confini di sicurezza l’autorità corretta;
- può evolvere senza nascondere regressioni dietro uno score aggregato.

La priorità aggiornata è quindi netta:

> prima migliorare ciò che StarRouter capisce e sa di non capire; poi perfezionare ciò che calcola.
