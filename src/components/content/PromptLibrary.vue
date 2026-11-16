<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import {loadPromptLibrary,savePromptLibrary,promptHistoryEnabled,setPromptHistoryEnabled,clearPromptHistory,clearAllPrompts,containsCredential,PROMPT_TEXT_LIMIT,type PromptLibrary} from '../../utils/promptLibrary'
const props=defineProps<{open?:boolean}>()
watch(()=>props.open,open=>{if(open)load()})
const emit=defineEmits<{choose:[text:string];close:[]}>()
const library=ref<PromptLibrary>({presets:[],history:[]}),error=ref(''),name=ref(''),text=ref(''),editing=ref(''),historyEnabled=ref(false),saving=ref(false)
function onNameKeydown(event:KeyboardEvent){if(event.key==='Enter'&&!event.isComposing){event.preventDefault();event.stopPropagation()}}
async function load(){try{library.value=await loadPromptLibrary();historyEnabled.value=promptHistoryEnabled()}catch{error.value='Browser prompt storage unavailable or invalid. Back up stored data before using Clear all stored prompts and presets.'}}
function onStorage(event:StorageEvent){if(event.key?.endsWith('codex-web-local.prompt-library.v1.revision')||event.key?.endsWith('codex-web-local.prompt-history-enabled.v1'))load()}
onMounted(()=>{load();window.addEventListener('storage',onStorage)})
onUnmounted(()=>window.removeEventListener('storage',onStorage))
function toggleHistory(){try{setPromptHistoryEnabled(!historyEnabled.value);historyEnabled.value=!historyEnabled.value}catch{error.value='Browser storage write failed.'}}
async function clear(historyOnly:boolean){saving.value=true;try{library.value=await(historyOnly?clearPromptHistory():clearAllPrompts());error.value=''}catch{error.value='Browser storage write failed; saved prompts remain.'}finally{saving.value=false}}
async function save(next:PromptLibrary){saving.value=true;const previous=library.value;try{library.value=await savePromptLibrary(next,previous);error.value='';return true}catch(e){error.value=e instanceof Error?e.message:'Browser storage write failed; previous saved prompts may remain.';return false}finally{saving.value=false}}
async function savePreset(){if(containsCredential(text.value)){error.value='Remove credential-like text before saving a preset.';return}if(!name.value.trim()||!text.value.trim()){error.value='Enter a name and text.';return}if(!editing.value&&library.value.presets.length>=20){error.value='Limit: 20 presets. Delete one first.';return}
 const preset={id:editing.value||`preset-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:name.value.trim().slice(0,80),text:text.value.slice(0,PROMPT_TEXT_LIMIT)}
 if(await save({...library.value,presets:editing.value&&library.value.presets.some(p=>p.id===editing.value)?library.value.presets.map(p=>p.id===editing.value?preset:p):[...library.value.presets,preset]})){editing.value='';name.value='';text.value=''}
}
</script>
<template>
 <section class="feature-panel prompt-library" aria-label="Text presets and recent prompts">
  <button type="button" :disabled="saving" @click="emit('close')">Close prompts</button>
  <p>Supported commands: /goal, /plan, /prompts (/presets, /history), /help; in conversations: /review, /compact, /diff, /processes open their controls. Unknown slash input is sent as text. Skills appear in slash suggestions.</p>
  <p>Text only, saved in this browser's connection profile. Up to 20 presets and 30 recent prompts when enabled (8,000 characters each). Selecting replaces draft text for editing; it never sends.</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <h3>Text presets</h3>
  <ul><li v-for="preset in library.presets" :key="preset.id"><button type="button" :disabled="saving" @click="emit('choose',preset.text)">Use preset {{ preset.name }}</button><button type="button" :disabled="saving" @click="editing=preset.id;name=preset.name;text=preset.text">Edit preset {{ preset.name }}</button><button type="button" :disabled="saving" @click="save({...library,presets:library.presets.filter(p=>p.id!==preset.id)})">Delete preset {{ preset.name }}</button></li></ul>
  <input v-model="name" @keydown="onNameKeydown" aria-label="Preset name" maxlength="80" placeholder="Preset name" />
  <textarea v-model="text" aria-label="Preset text" :maxlength="PROMPT_TEXT_LIMIT" placeholder="Preset text" />
  <button type="button" :disabled="saving" @click="savePreset">{{ editing?'Save preset changes':'Save text preset' }}</button>
  <button v-if="editing" type="button" @click="editing='';name='';text=''">Cancel preset edit</button>
  <h3>Recent submitted prompts</h3>
  <button type="button" :disabled="saving" :aria-pressed="historyEnabled" @click="toggleHistory">{{ historyEnabled?'Disable':'Enable' }} recent prompt history</button>
  <p>Recording is off by default. Existing history is retained until you clear it. Presets are saved independently.</p>
  <ul><li v-for="(entry,index) in library.history" :key="index"><button type="button" :disabled="saving" @click="emit('choose',entry)">{{ entry.slice(0,120) }}</button><button type="button" :disabled="saving" :aria-label="`Delete recent prompt ${index+1}`" @click="save({...library,history:library.history.filter((_,i)=>i!==index)})">Delete</button></li></ul>
  <button type="button" :disabled="saving" @click="clear(true)">Clear recent prompt history</button>
  <button type="button" :disabled="saving" @click="clear(false)">Clear all stored prompts and presets</button>
 </section>
</template>
