// Issue panel entry point. Theming is enabled BEFORE the first render so
// Atlassian design tokens (--ds-*) are present when styles resolve; the app
// renders either way — a theming failure must never blank the panel.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableTheming } from '../shared/bridge.js';
import '../shared/tokens.css';
import App from './App.jsx';

const root = createRoot(document.getElementById('root'));
const render = () => root.render(<App />);
enableTheming().then(render, render);
