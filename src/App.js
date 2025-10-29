// App.js
import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';


const LS_KEY = 'ruleta_predictor_v2_1';
const FIB = [1, 1, 2, 3, 5, 8, 13, 21];

function getDocena(n) {
  if (n === 0) return 0;
  if (n >= 1 && n <= 12) return 1;
  if (n >= 13 && n <= 24) return 2;
  if (n >= 25 && n <= 36) return 3;
  return null;
}
function labelDocena(d) {
  if (d === 0) return 'Cero (0)';
  if (d === 1) return '1ª';
  if (d === 2) return '2ª';
  if (d === 3) return '3ª';
  return '-';
}

export default function App() {
  const [numbers, setNumbers] = useState([]);
  const [input, setInput] = useState('');
  const [analyzeLast, setAnalyzeLast] = useState(30);
  const [useAltDocena, setUseAltDocena] = useState(true);
  const [predictions, setPredictions] = useState([]);
  const [botStats, setBotStats] = useState({ won: 0, lost: 0 });
  const [fiboIndex, setFiboIndex] = useState(0);
  const [currentPred, setCurrentPred] = useState(null); // {primary, alt?, score, roundsHeld}

  // load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setNumbers(p.numbers || []);
        setPredictions(p.predictions || []);
        setBotStats(p.botStats || { won: 0, lost: 0 });
        setFiboIndex(p.fiboIndex || 0);
        setAnalyzeLast(p.analyzeLast || 30);
        setUseAltDocena(typeof p.useAltDocena === 'boolean' ? p.useAltDocena : true);
        setCurrentPred(p.currentPred || null);
      }
    } catch (e) {
      console.warn('load error', e);
    }
  }, []);

  // persist
  useEffect(() => {
    const payload = { numbers, predictions, botStats, fiboIndex, analyzeLast, currentPred, useAltDocena };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('save error', e);
    }
  }, [numbers, predictions, botStats, fiboIndex, analyzeLast, currentPred, useAltDocena]);

  // derived
  const lastNumbers = useMemo(() => numbers.slice(-analyzeLast), [numbers, analyzeLast]);
  const counts = useMemo(() => {
    const c = { 0: 0, 1: 0, 2: 0, 3: 0 };
    lastNumbers.forEach((n) => {
      const d = getDocena(n);
      if (d !== null) c[d]++;
    });
    return c;
  }, [lastNumbers]);

  const totalAnalyzed = Math.max(1, lastNumbers.length);

  const absence = useMemo(() => {
    const res = { 0: null, 1: null, 2: null, 3: null };
    for (let d = 0; d <= 3; d++) {
      let found = false;
      for (let i = numbers.length - 1, gap = 0; i >= 0; i--, gap++) {
        if (getDocena(numbers[i]) === d) {
          res[d] = gap;
          found = true;
          break;
        }
      }
      if (!found) res[d] = null;
    }
    return res;
  }, [numbers]);

  const streak = useMemo(() => {
    const res = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (let d = 0; d <= 3; d++) {
      for (let i = numbers.length - 1; i >= 0; i--) {
        if (getDocena(numbers[i]) === d) res[d]++; else break;
      }
    }
    return res;
  }, [numbers]);

  // dynamic weights and scores
const scores = useMemo(() => {
  const result = {};

  // evita división por cero
  if (totalAnalyzed === 0) {
    result[1] = 0;
    result[2] = 0;
    result[3] = 0;
    return result;
  }

  // normalizar frecuencia y ausencia
  const freqNorm = {};
  const absenceNorm = {};

  // calcular un máximo razonable para normalizar ausencia
  // si todas son null, maxAbs será 0
  const absValues = Object.values(absence).filter((v) => v !== null && typeof v === 'number');
  const maxAbs = absValues.length ? Math.max(...absValues) : 0;

  for (let d = 1; d <= 3; d += 1) {
    freqNorm[d] = counts[d] / totalAnalyzed;
    if (maxAbs > 0) {
      absenceNorm[d] = (absence[d] === null ? maxAbs : absence[d]) / maxAbs;
    } else {
      // si no hay ausencias registradas, normalizamos a 0
      absenceNorm[d] = 0;
    }
  }

  // calcular score por docena con pesos dinámicos
  for (let d = 1; d <= 3; d += 1) {
    let wFreq = 0.6;
    let wAbs = 0.4;

    // si hay racha >= 2, favorecer frecuencia
    if (streak[d] >= 2) {
      wFreq = 0.8;
      wAbs = 0.2;
    }

    // si ausencia prolongada (>=5), favorecer ausencia
    if (absence[d] !== null && absence[d] >= 5) {
      wAbs = 0.7;
      wFreq = 0.3;
    }

    // normalizar pesos antes de combinar
    const norm = wFreq + wAbs;
    wFreq = wFreq / norm;
    wAbs = wAbs / norm;

    // calcular score (0..1)
    const score = freqNorm[d] * wFreq + absenceNorm[d] * wAbs;
    result[d] = Math.round(score * 1000) / 1000;
  }

  return result;
}, [counts, absence, streak, totalAnalyzed, analyzeLast]);

  const chartData = [1, 2, 3].map((d) => ({ name: labelDocena(d), score: Math.round(scores[d] * 1000) / 10, docena: d }));

  function strengthLabel(score) {
    if (score > 0.65) return 'Fuerte';
    if (score > 0.45) return 'Moderada';
    return 'Débil';
  }

  // stabilization: keep pred at least 3 rounds unless alternative > current*1.2; additional rule: if current had 2 wins in a row, keep if current > others*0.9
  useEffect(() => {
    if (numbers.length < 10) return; // wait for samples

    const entries = [1, 2, 3].map((d) => ({ d, score: scores[d] }));
    entries.sort((a, b) => b.score - a.score);
    const best = entries[0];
    const second = entries[1];

    if (!currentPred) {
      setCurrentPred({ primary: best.d, alt: useAltDocena ? second.d : null, score: best.score, roundsHeld: 1 });
      return;
    }

    // if best is same as current primary -> update
    if (best.d === currentPred.primary) {
      setCurrentPred((p) => ({ ...p, score: best.score, roundsHeld: p.roundsHeld + 1, alt: useAltDocena ? second.d : null }));
      return;
    }

    // if current has 2 wins in a row (check last predictions) prefer to keep unless new best >> current
    const lastTwo = predictions.slice().reverse().filter(p => p.result).slice(0,2);
    const lastTwoWins = lastTwo.length >= 2 && lastTwo[0].result === 'win' && lastTwo[1].result === 'win' && lastTwo[0].predictedDocena === currentPred.primary && lastTwo[1].predictedDocena === currentPred.primary;

    const threshold = currentPred.score * 1.2;
    if (best.score >= threshold) {
      setCurrentPred({ primary: best.d, alt: useAltDocena ? second.d : null, score: best.score, roundsHeld: 1 });
    } else if (lastTwoWins && best.score < currentPred.score * 1.1) {
      // keep current
      setCurrentPred((p) => ({ ...p, roundsHeld: p.roundsHeld + 1 }));
    } else if (currentPred.roundsHeld >= 3) {
      setCurrentPred({ primary: best.d, alt: useAltDocena ? second.d : null, score: best.score, roundsHeld: 1 });
    } else {
      setCurrentPred((p) => ({ ...p, roundsHeld: p.roundsHeld + 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, numbers.length, useAltDocena]);

  function recommendPlenos(d, take = 6) {
    if (d === 0) return [0];
    const start = d === 1 ? 1 : d === 2 ? 13 : 25;
    const end = d === 1 ? 12 : d === 2 ? 24 : 36;
    const lastApp = {};
    for (let n = start; n <= end; n++) lastApp[n] = null;
    for (let i = numbers.length - 1, gap = 0; i >= 0; i--, gap++) {
      const num = numbers[i];
      if (num >= start && num <= end && lastApp[num] === null) lastApp[num] = gap;
    }
    const arr = Object.keys(lastApp).map((k) => ({ n: parseInt(k, 10), last: lastApp[k] === null ? Number.MAX_SAFE_INTEGER : lastApp[k] }));
    arr.sort((a, b) => b.last - a.last || a.n - b.n);
    return arr.slice(0, take).map((x) => x.n);
  }

  // add number: evaluate previous pending prediction; if prediction had primary+alt, count win if number in either
  function addNumber(num) {
    if (!Number.isInteger(num) || num < 0 || num > 36) {
      alert('Número inválido (0–36)');
      return;
    }

    setPredictions((prev) => {
      const copy = [...prev];
      const lastPendingIndex = copy.map((p) => p).reverse().findIndex((p) => p.result === null);
      if (lastPendingIndex !== -1) {
        const realIndex = copy.length - 1 - lastPendingIndex;
        const pred = copy[realIndex];
        if (pred && pred.result === null) {
          const realDoc = getDocena(num);
          const primaryHit = pred.predictedDocena === realDoc;
          const altHit = pred.altPred && pred.altPred === realDoc;
          const won = primaryHit || altHit;

          copy[realIndex] = { ...pred, result: won ? 'win' : 'loss', numberWhenEvaluated: num };

          // adjust stats & fibo by strength
          setBotStats((s) => ({ won: s.won + (won ? 1 : 0), lost: s.lost + (won ? 0 : 1) }));

          const predScore = pred.score;
          const str = strengthLabel(predScore);
          if (won) setFiboIndex(0);
          else {
            if (str === 'Fuerte') setFiboIndex((i) => Math.min(i + 1, FIB.length - 1));
            else if (str === 'Moderada') setFiboIndex((i) => i);
            else if (str === 'Débil') setFiboIndex((i) => i);
          }
        }
      }
      return copy;
    });

    // append number
    setNumbers((prev) => [...prev, num]);

    // create new pending prediction based on currentPred (after tiny delay)
    setTimeout(() => {
      const primary = currentPred ? currentPred.primary : Number(Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0]);
      const alt = useAltDocena ? (Object.entries(scores).sort((a,b)=>b[1]-a[1])[1][0] ? Number(Object.entries(scores).sort((a,b)=>b[1]-a[1])[1][0]) : null) : null;
      const predScore = scores[primary];
      const newPred = {
        id: Date.now(),
        createdAt: new Date().toISOString(),
        predictedDocena: primary,
        altPred: alt,
        method: 'Analítico híbrido v2.1',
        score: predScore,
        strength: strengthLabel(predScore),
        prob: ((counts[primary] / totalAnalyzed) * 100),
        result: null,
      };
      setPredictions((p) => [...p, newPred]);
    }, 80);
  }

  const handleAddFromInput = () => {
    const n = Number(input);
    addNumber(n);
    setInput('');
  };

  const handleDeleteLast = () => {
    setNumbers((n) => n.slice(0, -1));
    setPredictions((p) => {
      const copy = [...p];
      if (copy.length && copy[copy.length - 1].result === null) copy.pop();
      return copy;
    });
  };

  const handleResetAll = () => {
    if (!window.confirm('Reiniciar todo?')) return;
    setNumbers([]);
    setPredictions([]);
    setBotStats({ won: 0, lost: 0 });
    setFiboIndex(0);
    setCurrentPred(null);
  };

  const effectiveness = useMemo(() => {
    const t = botStats.won + botStats.lost;
    return t ? Math.round((botStats.won / t) * 1000) / 10 : 0;
  }, [botStats]);

  const latestPred = predictions.length ? predictions[predictions.length - 1] : null;

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="logo"><h1>Rouledict</h1></div>
        <div className="controls">
          <input
            type="number"
            min={0}
            max={36}
            placeholder="Número 0–36"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddFromInput()}
          />
          <button className="btn primary" onClick={handleAddFromInput}>Agregar</button>
          <button className="btn muted" onClick={handleDeleteLast}>Eliminar ultimo número</button>
          <button className="btn danger" onClick={handleResetAll}>Reiniciar</button>
        </div>
      </header>

      <main className="main">
        <section className="left">
          <div className="section card">
            <div className="section-header">
              <div className="settings">
              <h2>Análisis Actual</h2>
                <label className='styled-select-label'>Analizar últimos:
                  <select value={analyzeLast} onChange={(e) => setAnalyzeLast(Number(e.target.value))}>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={30}>30</option>
                    <option value={40}>40</option>
                    <option value={50}>50</option>
                    <option value={60}>60</option>
                    <option value={70}>70</option>
                    <option value={80}>80</option>
                    <option value={90}>90</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <label className='styled-checkbox'>
                  <input type="checkbox" checked={useAltDocena} onChange={(e)=>setUseAltDocena(e.target.checked)} /> Jugar docena alternativa
                </label>
              </div>
            </div>

            <div className="analysis-grid">
              <div className="analysis-table">
                <table>
                  <thead>
                    <tr><th>Docena</th><th>Rango</th><th>Frecuencia</th><th>Ausencia</th><th>Racha</th><th>Score</th></tr>
                  </thead>
                  <tbody>
                    {[1,2,3].map((d)=> (
                      <tr key={d} className={currentPred && currentPred.primary===d? 'predicted':''}>
                        <td>{labelDocena(d)}</td>
                        <td>{d===1?'1–12':d===2?'13–24':'25–36'}</td>
                        <td>{counts[d]||'—'}</td>
                        <td>{absence[d]===null?'—':absence[d]}</td>
                        <td>{streak[d]||'—'}</td>
                        <td>{scores[d].toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="chart-box">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.06} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v)=> v + '%'} />
                    <Tooltip formatter={(v)=> `${v}%`} />
                    <Bar dataKey="score" fill="#00d4ff" />
                  </BarChart>
                </ResponsiveContainer>
                <div className="chart-legend">Score (0..100)</div>
              </div>
            </div>
          </div>

          <div className="section card small">
            <h3>Historial de números (último a la izquierda)</h3>
            <div className="hist-list reverse">
              {numbers.length===0 && <div className="muted">No hay números aún</div>}
              {numbers.map((n,i)=> <span key={i} className={`hist-num doc-${getDocena(n)}`}>{n}</span>)}
            </div>
          </div>
        </section>

        <aside className="right">
          <div className="section card prediction-area">
            <h3>Predicción Actual</h3>
            {currentPred ? (
              <div className={`pred-card ${latestPred && latestPred.result==='win'? 'pred-win' : latestPred && latestPred.result==='loss' ? 'pred-lose' : ''}`}>
                <div className="pred-main">
                  <div className="pred-docena">{labelDocena(currentPred.primary)}{useAltDocena && currentPred.alt? ` + ${labelDocena(currentPred.alt)}` : ''}</div>
                  <div className="pred-score">{(currentPred.score*100).toFixed(1)}%</div>
                </div>
                <div className="pred-strength">{strengthLabel(currentPred.score)}</div>
                <div className="pred-meta">Rondas retenidas: {currentPred.roundsHeld}</div>
                <div className="pred-plenos">Plenos: {recommendPlenos(currentPred.primary,6).map(n=> <span key={n} className="pleno-pill">{n}</span>)}{useAltDocena && currentPred.alt? <> • Alt plenos: {recommendPlenos(currentPred.alt,4).map(n=> <span key={n} className="pleno-pill">{n}</span>)}</> : null}</div>
              </div>
            ) : (
              <div className="muted">Esperando al menos 10 tiros para predecir...</div>
            )}

            <div className="bot-stats">
              <div className="stat"><div className="stat-num">{botStats.won}</div><div className="stat-label">Ganadas</div></div>
              <div className="stat"><div className="stat-num">{botStats.lost}</div><div className="stat-label">Perdidas</div></div>
              <div className="stat"><div className="stat-num">{effectiveness}%</div><div className="stat-label">Efectividad</div></div>
            </div>

            <div className="fibo-box">
              <div>Fibo ronda: <strong>{fiboIndex+1}</strong></div>
              <div>Apuesta: <strong>{FIB[Math.min(fiboIndex, FIB.length-1)]}</strong></div>
            </div>
          </div>

          <div className="section card history-card">
            <h3>Historial de Predicciones</h3>
            <div className="pred-history">
              {predictions.length===0 && <div className="muted">Sin predicciones</div>}
              {predictions.slice().reverse().map((p)=> (
                <div key={p.id} className={`pred-row ${p.result==='win'?'win':p.result==='loss'?'loss':''}`}>
                  <div className="pred-row-left">
                    <div className="pred-label">{labelDocena(p.predictedDocena)}{p.altPred? ` + ${labelDocena(p.altPred)}`: ''}</div>
                    <div className="pred-meta-small">{p.method} • {p.strength}</div>
                  </div>
                  <div className="pred-row-right">
                    <div className="pred-prob-small">{(p.score*100).toFixed(1)}%</div>
                    <div className={`pred-result ${p.result||'pending'}`}>{p.result==='win'?'✅':p.result==='loss'?'❌':'⏳'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <footer className="footer">v2.0</footer>
    </div>
  );
}
