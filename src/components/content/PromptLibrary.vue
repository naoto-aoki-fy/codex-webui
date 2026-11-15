<script setup lang="ts">
import {onMounted,ref,watch} from 'vue'
import {loadPromptLibrary,savePromptLibrary,containsCredential,PROMPT_TEXT_LIMIT,type PromptLibrary} from '../../utils/promptLibrary'
const props=defineProps<{open?:boolean}>()
watch(()=>props.open,open=>{if(open)load()})
const emit=defineEmits<{choose:[text:string];close:[]}>()
const library=ref<PromptLibrary>({presets:[],history:[]}),error=ref(''),name=ref(''),text=ref(''),editing=ref('')
function onNameKeydown(event:KeyboardEvent){if(event.key==='Enter'&&!event.isComposing){event.preventDefault();event.stopPropagation()}}
function load(){try{library.value=loadPromptLibrary()}catch{error.value='Browser prompt storage unavailable or invalid. Clear stored prompts explicitly to recover.'}}
onMounted(load)
function save(next:PromptLibrary){try{savePromptLibrary(next);library.value=next;error.value='';return true}catch{error.value='Browser storage write failed; previous saved prompts may remain.';return false}}
function savePreset(){if(containsCredential(text.value)){error.value='Remove credential-like text before saving a preset.';return}if(!name.value.trim()||!text.value.trim()){error.value='Enter a name and text.';return}if(!editing.value&&library.value.presets.length>=20){error.value='Limit: 20 presets. Delete one first.';return}
 const preset={id:editing.value||`preset-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:name.value.trim().slice(0,80),text:text.value.slice(0,PROMPT_TEXT_LIMIT)}
 if(save({...library.value,presets:editing.value?library.value.presets.map(p=>p.id===editing.value?preset:p):[...library.value.presets,preset]})){editing.value='';name.value='';text.value=''}
}
</script>
<template>
 <section class="feature-panel prompt-library" aria-label="Text presets and recent prompts">
  <button type="button" @click="emit('close')">Close prompts</button>
  <p>Supported commands: /goal, /plan, /prompts (/presets, /history), /help; in conversations: /review, /compact, /diff, /processes open their controls. Unknown slash input is sent as text. Skills appear in slash suggestions.</p>
  <p>Text only, saved in this browser's connection profile. Up to 20 presets and 30 accepted prompts (8,000 characters each). Selecting replaces draft text for editing; it never sends.</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <h3>Text presets</h3>
  <ul><li v-for="preset in library.presets" :key="preset.id"><button type="button" @click="emit('choose',preset.text)">Use preset {{ preset.name }}</button><button type="button" @click="editing=preset.id;name=preset.name;text=preset.text">Edit preset {{ preset.name }}</button><button type="button" @click="save({...library,presets:library.presets.filter(p=>p.id!==preset.id)})">Delete preset {{ preset.name }}</button></li></ul>
  <input v-model="name" @keydown="onNameKeydown" aria-label="Preset name" maxlength="80" placeholder="Preset name" />
  <textarea v-model="text" aria-label="Preset text" :maxlength="PROMPT_TEXT_LIMIT" placeholder="Preset text" />
  <button type="button" @click="savePreset">{{ editing?'Save preset changes':'Save text preset' }}</button>
  <button v-if="editing" type="button" @click="editing='';name='';text=''">Cancel preset edit</button>
  <h3>Recent submitted prompts</h3>
  <ul><li v-for="(entry,index) in library.history" :key="index"><button type="button" @click="emit('choose',entry)">{{ entry.slice(0,120) }}</button><button type="button" :aria-label="`Delete recent prompt ${index+1}`" @click="save({...library,history:library.history.filter((_,i)=>i!==index)})">Delete</button></li></ul>
  <button type="button" @click="save({...library,history:[]})">Clear recent prompt history</button>
  <button type="button" @click="save({presets:[],history:[]})">Clear all stored prompts and presets</button>
 </section>
</template>
