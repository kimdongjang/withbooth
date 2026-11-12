import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as React from 'react';
import {renderToString} from 'react-dom/server';
test('unsaved changes hook renders with the same React runtime as React DOM',async()=>{
 const context=vm.createContext({});const module=new vm.SourceTextModule(await readFile(new URL('../src/hooks/useUnsavedChanges.js',import.meta.url),'utf8'),{context});
 await module.link(name=>{const exports=name==='react'?React:{confirmAction:async()=>true};return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});});await module.evaluate();
 function Screen(){module.namespace.useUnsavedChanges(true);return React.createElement('span',null,'ready');}
 assert.equal(renderToString(React.createElement(Screen)),'<span>ready</span>');
});

test('unsaved changes ask once per dirty period and skip navigation-free guards',async()=>{
 const slots=[];let cursor=0,asked=0,answer=true;
 const react={useRef:initial=>{const index=cursor++;return slots[index]||=({current:initial});},useEffect:fn=>{const index=cursor++;if(!slots[index]){slots[index]=true;fn();}}};
 const context=vm.createContext({window:{addEventListener(){},removeEventListener(){}}});const module=new vm.SourceTextModule(await readFile(new URL('../src/hooks/useUnsavedChanges.js',import.meta.url),'utf8'),{context});
 await module.link(name=>{const exports=name==='react'?react:{confirmAction:async()=>{asked++;return answer;}};return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});});await module.evaluate();
 const {useUnsavedChanges,allowNavigation}=module.namespace;
 const render=(form,cart)=>{cursor=0;useUnsavedChanges(form);useUnsavedChanges(cart,{navigation:false});};
 render(false,true);assert.equal(await allowNavigation(),true);assert.equal(asked,0);
 render(true,true);answer=false;assert.equal(await allowNavigation(),false);assert.equal(asked,1);
 answer=true;assert.equal(await allowNavigation(),true);assert.equal(asked,2);
 render(true,true);assert.equal(await allowNavigation(),true);assert.equal(asked,2);
 render(false,true);render(true,true);assert.equal(await allowNavigation(),true);assert.equal(asked,3);
});

test('event read subscriptions survive edit mode and suppress draft refresh until editing ends',async()=>{
 const slots=[],effects=[];let cursor=0,subscriptions=0,notify,cleanup;
 const react={
  useState:initial=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useRef:initial=>{const index=cursor++;return slots[index]||=( {current:initial});},
  useEffect:(fn,deps)=>{const index=cursor++;if(!slots[index]||deps.some((value,i)=>value!==slots[index][i])){slots[index]=deps;effects.push(fn);}},
 };
 const context=vm.createContext({});const module=new vm.SourceTextModule(await readFile(new URL('../src/hooks/useEventReadRefresh.js',import.meta.url),'utf8'),{context});
 await module.link(()=>new vm.SyntheticModule(Object.keys(react),function(){for(const[key,value]of Object.entries(react))this.setExport(key,value);},{context}));await module.evaluate();
 const request={subscribe:listener=>{subscriptions++;notify=listener;return()=>{notify=null;};}};
 const render=enabled=>{cursor=0;const revision=module.namespace.useEventReadRefresh(request,enabled);while(effects.length)cleanup=effects.shift()();return revision;};
 assert.equal(render(true),0);notify();assert.equal(render(false),1);
 notify();assert.equal(render(false),1);assert.equal(subscriptions,1);
 assert.equal(render(true),1);notify();assert.equal(render(true),2);
 cleanup();assert.equal(notify,null);
});
