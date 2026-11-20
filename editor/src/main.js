import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import favicon from '../../assets/brand/favicon.svg'

// favicon de la marca (assets/brand)
document.querySelector('link[rel=icon]')?.setAttribute('href', favicon)

mount(App, { target: document.getElementById('app') })
