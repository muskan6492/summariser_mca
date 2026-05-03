import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Sparkles,
  History,
  FileJson,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { jsPDF } from 'jspdf';

const API_BASE = 'http://localhost:5001/api';

function App() {
  const [inputText, setInputText] = useState('');
  const [file, setFile] = useState(null);
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [config, setConfig] = useState({
    length: 'medium',
    format: 'paragraph'
  });
  const [activeTab, setActiveTab] = useState('text'); // 'text' or 'pdf'
  const fileInputRef = useRef(null);

  // Load History from MongoDB
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await axios.get(`${API_BASE}/history`);
        if (res.data.status === 'success') {
          setHistory(res.data.data.history);
        }
      } catch (err) {
        console.error("Failed to fetch history:", err);
      }
    };
    fetchHistory();
  }, []);


  const deleteHistoryItem = async (e, id) => {
    e.stopPropagation();
    try {
      const res = await axios.delete(`${API_BASE}/history/${id}`);
      if (res.data.status === 'success') {
        setHistory(prev => prev.filter(item => item._id !== id));
      }
    } catch (err) {
      console.error("Failed to delete item:", err);
      setError("Failed to delete history item");
    }
  };

  const clearHistory = async () => {
    if (!window.confirm("Are you sure you want to clear all history?")) return;
    try {
      const res = await axios.delete(`${API_BASE}/history-clear`);
      if (res.data.status === 'success') {
        setHistory([]);
      }
    } catch (err) {
      console.error("Failed to clear history:", err);
      setError("Failed to clear history");
    }
  };

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (selectedFile.size > 5 * 1024 * 1024) {
      setError('File size too large. Max 5MB allowed.');
      return;
    }

    setFile(selectedFile);
    setError('');
  };

  const processSummarize = async () => {
    setIsLoading(true);
    setError('');
    setSummary('');

    try {
      let textToSummarize = inputText;

      // Handle PDF Upload first
      if (activeTab === 'pdf' && file) {
        setLoadingStage('Uploading PDF...');
        const formData = new FormData();
        formData.append('file', file);

        const uploadRes = await axios.post(`${API_BASE}/upload`, formData);
        if (uploadRes.data.status === 'success') {
          textToSummarize = uploadRes.data.data.text;
          setLoadingStage('Parsing document...');
        } else {
          throw new Error(uploadRes.data.message);
        }
      }

      if (!textToSummarize || textToSummarize.trim().length < 50) {
        throw new Error('Please provide at least 50 characters of text.');
      }

      setLoadingStage('Generating AI summary...');
      const title = activeTab === 'pdf' ? file.name : (inputText.substring(0, 30) + '...');
      
      const summarizeRes = await axios.post(`${API_BASE}/summarize`, {
        text: textToSummarize,
        length: config.length,
        format: config.format,
        title: title
      });

      if (summarizeRes.data.status === 'success') {
        const result = summarizeRes.data.data.summary;
        const newItem = summarizeRes.data.data.item;
        setSummary(result);
        
        // Update history locally with the item returned from server
        if (newItem) {
          setHistory(prev => [newItem, ...prev].slice(0, 20));
        }
      } else {
        throw new Error(summarizeRes.data.message);
      }

    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setIsLoading(false);
      setLoadingStage('');
    }
  };

  const downloadSummary = (type) => {
    if (!summary) return;

    if (type === 'txt') {
      const element = document.createElement("a");
      const file = new Blob([summary], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = "summary.txt";
      document.body.appendChild(element);
      element.click();
    } else {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text("AI Summarizer Output", 10, 10);
      doc.setFontSize(11);
      const splitText = doc.splitTextToSize(summary, 180);
      doc.text(splitText, 10, 20);
      doc.save("summary.pdf");
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <Sparkles className="primary" />
          <span>SummarizeAI</span>
        </div>

        <div className="history-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', margin: 0 }}>
              <History size={18} /> Recent
            </h3>
            {history.length > 0 && (
              <button 
                onClick={clearHistory}
                style={{ background: 'none', border: 'none', color: 'var(--error)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
              >
                Clear All
              </button>
            )}
          </div>
          <div className="history-list">
            {history.map(item => (
              <div 
                key={item._id} 
                className="history-item" 
                onClick={() => {
                  setSummary(item.summary);
                  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ 
                      fontWeight: 600, 
                      color: 'var(--primary)', 
                      marginBottom: '0.25rem', 
                      fontSize: '0.9rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }} title={item.title}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
                      {new Date(item.date).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteHistoryItem(e, item._id);
                    }}
                    style={{ opacity: 1, padding: '4px' }}
                    title="Delete Summary"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            {history.length === 0 && <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>No history yet</p>}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="header">
          <div>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800 }}>AI Abstractor</h1>
            <p style={{ color: 'var(--text-dim)' }}>Transform complex documents into concise insights</p>
          </div>
        </header>

        <section className="input-section glass-card">
          <div className="tab-container">
            <button
              className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
              onClick={() => setActiveTab('text')}
            >
              Paste Text
            </button>
            <button
              className={`tab-btn ${activeTab === 'pdf' ? 'active' : ''}`}
              onClick={() => setActiveTab('pdf')}
            >
              Upload PDF
            </button>
          </div>

          {activeTab === 'text' ? (
            <textarea
              placeholder="Paste your long text here (minimum 50 characters)..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
          ) : (
            <div className="upload-zone" onClick={() => fileInputRef.current.click()}>
              <input
                type="file"
                hidden
                ref={fileInputRef}
                accept=".pdf"
                onChange={handleFileUpload}
              />
              <Upload size={48} className="primary" style={{ opacity: 0.5 }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontWeight: 600 }}>{file ? file.name : 'Click to select or drag and drop PDF'}</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>Maximum file size: 5MB</p>
              </div>
            </div>
          )}

          <div className="controls">
            <div className="control-group">
              <label style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>Length:</label>
              <select
                value={config.length}
                onChange={(e) => setConfig({ ...config, length: e.target.value })}
              >
                <option value="short">Short (TL;DR)</option>
                <option value="medium">Detailed (Standard)</option>

              </select>
            </div>

            <div className="control-group">
              <label style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>Format:</label>
              <select
                value={config.format}
                onChange={(e) => setConfig({ ...config, format: e.target.value })}
              >
                <option value="paragraph">Paragraph</option>
                <option value="bullet">Bullet Points</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="error-toast">
              <AlertCircle size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              {error}
            </div>
          )}

          <button
            className="summarize-btn"
            onClick={processSummarize}
            disabled={isLoading || (activeTab === 'text' ? !inputText : !file)}
          >
            {isLoading ? (
              <>Summarizing...</>
            ) : (
              <>
                <Sparkles size={18} /> Summarize Now
              </>
            )}
          </button>
        </section>

        {isLoading && (
          <div className="loader glass-card">
            <div className="spinner"></div>
            <p style={{ fontWeight: 600, color: 'var(--primary)' }}>{loadingStage}</p>
          </div>
        )}

        {summary && !isLoading && (
          <section className="result-section glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <CheckCircle2 color="var(--success)" /> Summary Output
              </h2>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="tab-btn" onClick={() => downloadSummary('txt')} style={{ border: '1px solid var(--border)' }}>
                  <FileText size={18} /> TXT
                </button>
                <button className="tab-btn" onClick={() => downloadSummary('pdf')} style={{ border: '1px solid var(--border)' }}>
                  <FileJson size={18} /> PDF
                </button>
              </div>
            </div>
            <div className="summary-content">
              {summary}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
