import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import {
  DatasetList, QualityHeader, Insights, ColumnCard, Anomalies,
  Correlations, TestForm, ResultCard, ChatPanel, ChatAnalysisCard, DataHead,
} from './components.jsx';

export default function App() {
  const [datasets, setDatasets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [messages, setMessages] = useState([]);
  const [testResult, setTestResult] = useState(null);
  const [testQuestion, setTestQuestion] = useState('');
  const [chatViz, setChatViz] = useState(null);
  const [status, setStatus] = useState({ storage: '…', llm: '…' });
  const [uploading, setUploading] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (selectId) => {
    try {
      const data = await api.listDatasets();
      setDatasets(data.datasets);
      setStatus({ storage: data.storage, llm: data.llm });
      const target = selectId || (data.datasets[0] && data.datasets[0].id);
      if (target) setSelectedId(target);
    } catch (e) {
      setError(`Could not reach the backend: ${e.message}`);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedId) { setDataset(null); return; }
    setTestResult(null);
    setChatViz(null);
    api.getDataset(selectedId).then(setDataset).catch((e) => setError(e.message));
    api.getChat(selectedId).then((d) => {
      setMessages(d.messages);
      // pin the most recent computed analysis so visitors land on a worked example
      for (let i = d.messages.length - 1; i >= 0; i--) {
        const m = d.messages[i];
        if (m.role === 'assistant' && m.result && !m.result.error && m.intent && m.intent.action !== 'answer') {
          setChatViz({
            question: d.messages[i - 1] && d.messages[i - 1].role === 'user' ? d.messages[i - 1].content : '',
            answer: m.content, intent: m.intent, result: m.result, mode: m.mode,
          });
          break;
        }
      }
    }).catch(() => setMessages([]));
  }, [selectedId]);

  const onUpload = async (name, csv) => {
    setUploading(true); setError(null);
    try {
      const res = await api.uploadCSV(name, csv);
      await refresh(res.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id) => {
    if (!confirm('Delete this dataset?')) return;
    await api.deleteDataset(id).catch(() => {});
    if (id === selectedId) setSelectedId(null);
    refresh();
  };

  const onSend = async (question) => {
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setChatBusy(true);
    try {
      const { reply } = await api.sendChat(selectedId, question);
      setMessages((m) => [...m, reply]);
      if (reply.result && !reply.result.error && reply.intent && reply.intent.action !== 'answer') {
        setChatViz({ question, answer: reply.content, intent: reply.intent, result: reply.result, mode: reply.mode });
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong: ${e.message}` }]);
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">🔬 <strong>DataScope</strong> <span className="muted">— drop a CSV, get answers you can defend</span></div>
        <div className="status">
          <span className={`mode-badge ${status.storage === 'mongodb' ? 'llm' : 'rule'}`} title="where datasets are stored">db: {status.storage}</span>
        </div>
      </header>
      {error && <div className="error-bar">{error} <button onClick={() => setError(null)}>×</button></div>}
      <div className="layout">
        <DatasetList
          datasets={datasets} selectedId={selectedId}
          onSelect={setSelectedId} onUpload={onUpload} onDelete={onDelete} uploading={uploading}
        />
        <main className="pane pane-center">
          {!dataset ? (
            <div className="empty-state">
              <h2>Welcome to DataScope</h2>
              <p>Upload any CSV to get an instant profile: column types, quality score, anomalies — then test your hypotheses with real statistics.</p>
            </div>
          ) : (
            <>
              <DataHead dataset={dataset} />
              {chatViz && <ChatAnalysisCard item={chatViz} onClose={() => setChatViz(null)} />}
              <QualityHeader dataset={dataset} />
              <Insights insights={dataset.profile.insights} />
              <TestForm dataset={dataset} onResult={(r, q) => { setTestResult(r); setTestQuestion(q); }} />
              {testResult && <ResultCard result={testResult} question={testQuestion} />}
              <Anomalies anomalies={dataset.profile.anomalies} />
              <Correlations correlations={dataset.profile.correlations} />
              <h3 className="section-title">Columns</h3>
              <div className="col-grid">
                {dataset.profile.columns.map((c) => <ColumnCard key={c.name} col={c} rowCount={dataset.rowCount} />)}
              </div>
            </>
          )}
        </main>
        <ChatPanel dataset={dataset} messages={messages} onSend={onSend} busy={chatBusy} llmMode={status.llm} onVisualize={setChatViz} />
      </div>
    </div>
  );
}
