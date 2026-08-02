import './styles/app.css';
import { App } from './ui/app.js';
import { getLocale } from './i18n/index.js';

document.documentElement.lang = getLocale();

new App().start();
