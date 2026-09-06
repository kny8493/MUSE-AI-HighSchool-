import React from 'react';
import { createRoot } from 'react-dom/client';
import Lab from './app/Lab';
import './app/globals.css';
import './app/lab.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Lab />
  </React.StrictMode>,
);
