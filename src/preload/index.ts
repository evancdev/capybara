import { contextBridge } from 'electron'
import { sessionAPI } from './apis/session'

contextBridge.exposeInMainWorld('sessionAPI', sessionAPI)
