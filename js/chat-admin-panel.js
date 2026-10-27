(()=>{'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let client=null,user=null,permissions={role:'member',permissions:{}},profileTarget=null,profileTab='messages',presenceChannel=null,replyTo=null,roleCache=new Map();
const caps=[['delete_messages','Supprimer des messages'],['warn','Avertir'],['mute','Mute temporaire'],['ban','Bannir'],['view_history','Voir les historiques'],['manage_forum','Gérer le forum'],['view_logs','Voir le journal'],['publish_video','Publier des vidéos'],['manage_reports','Gérer les signalements']];
const allowed=cap=>permissions.role==='super_admin'||(permissions.role==='moderator'&&permissions.permissions?.[cap]===true);
function rpc(name,args={}){if(!client)throw Error('Connexion requise');return client.rpc(name,args)}
function announce(message){const n=$('chatNotice');if(n){n.textContent=message;n.classList.remove('hidden')}else alert(message)}
function roleLabel(){return permissions.role==='super_admin'?'Super admin':permissions.role==='moderator'?'Modérateur':'Membre'}
function assurePanel(){
 if(!$('avChatProfileBackdrop')){document.body.insertAdjacentHTML('beforeend',`<div id="avChatProfileBackdrop" class="av-chat-profile-backdrop" hidden><section class="av-chat-profile" role="dialog" aria-modal="true" aria-labelledby="avChatProfileTitle"><header class="av-chat-profile-head"><div id="avChatProfileAvatar" class="av-chat-profile-avatar">A</div><div><h3 id="avChatProfileTitle">Profil du membre</h3><small id="avChatProfileSub"></small></div><button id="avChatProfileClose" class="av-chat-profile-close" aria-label="Fermer">×</button></header><nav class="av-chat-profile-tabs" aria-label="Fiche utilisateur"><button data-profile-tab="messages" aria-selected="true">Messages</button><button data-profile-tab="sanctions" aria-selected="false">Sanctions</button></nav><div id="avChatProfileActions" class="av-chat-profile-content"></div></section></div>`)}
 if(!$('avChatReplyNotice')){$('chatForm')?.insertAdjacentHTML('afterbegin','<div id="avChatReplyNotice" class="av-chat-reply-composer" hidden><span id="avChatReplyText"></span><button id="avChatReplyCancel" type="button">Annuler</button></div>')}
 if(!$('avChatTyping')){$('chatForm')?.insertAdjacentHTML('beforebegin','<div id="avChatTyping" class="av-chat-typing" aria-live="polite"></div>')}
 const panel=$('chatAdminPanel');
 if(panel&&!$('avChatReports'))panel.insertAdjacentHTML('beforeend','<section id="avChatReports" class="av-chat-mod-manager" hidden><h4>Signalements ouverts</h4><div id="avChatReportList"></div></section>');
 if(panel&&!$('avChatModManager'))panel.insertAdjacentHTML('beforeend',`<section id="avChatModManager" class="av-chat-mod-manager" hidden><h4>Gestion des modérateurs</h4><p>Réservé au super administrateur. Le compte administrateur est protégé.</p><div class="av-chat-mod-search"><input id="avChatUserSearch" type="search" autocomplete="off" placeholder="Rechercher par pseudo ou e-mail"><button id="avChatUserSearchBtn" class="btn primary" type="button">Rechercher</button></div><div id="avChatSearchResults"></div><div id="avChatModeratorList"></div><label>Seuil d’avertissements avant proposition de ban <input id="avChatWarningThreshold" type="number" min="1" max="20" value="3"></label><button id="avChatSaveThreshold" type="button" class="btn">Enregistrer le seuil</button></section>`);
}
function addRoleBadge(){
 const nodes=[...document.querySelectorAll('#chatMessages [data-message-id]')];
 const ids=[...new Set(nodes.map(n=>n.dataset.userId).filter(Boolean))];
 if(!ids.length)return;
 rpc('chat_role_badges',{p_users:ids}).then(({data,error})=>{if(error||!data)return;for(const r of data){roleCache.set(r.user_id,r.role);document.querySelectorAll('#chatMessages [data-message-id][data-user-id="'+CSS.escape(r.user_id)+'"] .chat-meta').forEach(meta=>{if(meta.querySelector('.av-chat-role-badge'))return;const name=meta.querySelector('[data-chat-open-profile]')||meta.children[1];if(!name)return;if(r.role==='super_admin'||r.role==='moderator'){const b=document.createElement('span');b.className='av-chat-role-badge'+(r.role==='super_admin'?' super':'');b.textContent=r.role==='super_admin'?'Admin':'Modo';name.after(b)}})}}).catch(()=>{});
}
function decorateMessages(root=document){
 root.querySelectorAll?.('#chatMessages [data-message-id]').forEach(row=>{if(row.dataset.avDecorated)return;row.dataset.avDecorated='1';row.style.position='relative';const meta=row.querySelector('.chat-meta');if(meta){const spans=meta.querySelectorAll('span');if(spans[0])spans[0].setAttribute('data-chat-open-profile',row.dataset.userId||'');if(spans[1])spans[1].setAttribute('data-chat-open-profile',row.dataset.userId||'')}
 const tools=document.createElement('div');tools.className='av-chat-message-tools';const more=document.createElement('button');more.type='button';more.className='av-chat-more';more.textContent='…';more.setAttribute('aria-label','Actions du message');const menu=document.createElement('div');menu.className='av-chat-more-menu';menu.hidden=true;
 const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',e=>{e.stopPropagation();menu.hidden=true;fn()});menu.appendChild(b)};
 const messageId=row.dataset.messageId,uid=row.dataset.userId||'',content=row.querySelector('.chat-text')?.textContent||'';
 add('Répondre',()=>{replyTo=messageId;$('avChatReplyText').textContent='Réponse à : '+content.slice(0,90);$('avChatReplyNotice').hidden=false;$('chatInput')?.focus()});
 add('Copier',()=>navigator.clipboard?.writeText(content).catch(()=>{}));
 add('Signaler',async()=>{if(!user){announce('Connecte-toi pour signaler un message.');return}const reason=prompt('Motif du signalement :');if(!reason?.trim())return;const {error}=await rpc('chat_report_message',{p_message_id:Number(messageId),p_reason:reason.trim()});announce(error?'Le signalement n’a pas pu être envoyé.':'Message signalé aux modérateurs.')});
 if(allowed('delete_messages'))add('Supprimer',()=>moderate('delete_message',uid,'Suppression depuis le menu',null,Number(messageId)));
 if(allowed('warn'))add('Avertir',()=>moderate('warn',uid,''));
 if(allowed('ban'))add('Bannir',()=>moderate('ban',uid,''));
 more.addEventListener('click',e=>{e.stopPropagation();menu.hidden=!menu.hidden});tools.append(more,menu);row.appendChild(tools)});
 addRoleBadge();
}
async function moderate(action,target,reason='',duration=null,messageId=null){
 if(!user){announce('Connexion requise.');return}
 if(!target||target===user.id){announce('Cette action ne peut pas viser ce compte.');return}
 if(!reason){reason=prompt(action==='warn'?'Motif de l’avertissement :':action==='ban'?'Motif du bannissement :':'Motif de la modération :')||''}
 if(reason.trim().length<2){announce('Un motif est obligatoire.');return}
 if(action==='ban'&&!duration){duration=prompt('Durée : 1h, 24h, 7d, 30d'+(permissions.can_permanent_ban?', permanent':''),'24h')||''}if(action==='mute'&&!duration){duration=prompt('Durée du mute : 1h, 24h, 7d, 30d','1h')||''}
 const {data,error}=await rpc('chat_moderation_action',{p_action:action,p_target:target,p_reason:reason.trim(),p_duration:duration,p_message_id:messageId});
 if(error){announce('Action refusée : vérifie les permissions et le motif.');console.error('Moderation RPC failed',error);return}
 announce(action==='warn'?'Avertissement envoyé.':action==='ban'?'Bannissement appliqué.':'Action effectuée.');
 $('avChatProfileBackdrop')?.setAttribute('hidden','');
 document.dispatchEvent(new Event('animeverse:chat-admin-refresh'));
 if(action==='warn'&&data?.warning_count>=data?.warning_threshold&&confirm('Cette personne a atteint le seuil de '+data.warning_threshold+' avertissements. Proposer un bannissement ?'))await moderate('ban',target,'Récidive après avertissements','24h')
}
async function openProfile(target){
 if(!allowed('view_history')||!target)return;
 profileTarget=target;profileTab='messages';$('avChatProfileBackdrop').hidden=false;
 await loadProfile();
}
async function loadProfile(){
 if(!profileTarget)return;const content=$('avChatProfileActions');content.innerHTML='<p>Chargement de la fiche…</p>';
 const searchTerm=$('avChatMessageSearch')?.value?.trim()||null;const [p,m,s]=await Promise.all([rpc('chat_admin_user_panel',{p_target:profileTarget}),rpc('chat_admin_user_messages',{p_target:profileTarget,p_query:searchTerm}),rpc('chat_admin_user_sanctions',{p_target:profileTarget})]);
 if(p.error){content.innerHTML='<p>Impossible de charger cette fiche avec tes permissions actuelles.</p>';return}
 const info=p.data||{};$('avChatProfileTitle').textContent=info.display_name||'Membre';$('avChatProfileSub').textContent=roleLabel()+' · '+String(profileTarget).slice(0,8)+' · '+(info.created_at?'Inscrit le '+new Date(info.created_at).toLocaleDateString('fr-FR'):'');
 const avatar=$('avChatProfileAvatar');if(info.avatar_url){avatar.innerHTML='<img alt="" src="'+esc(info.avatar_url)+'">'}else avatar.textContent=(info.display_name||'A').slice(0,1).toUpperCase();
 const protectedUser=info.role==='super_admin'||info.role==='moderator'&&permissions.role!=='super_admin';
 const actions=$('avChatProfileActions');
 const actionButtons=protectedUser?'':`<div class="av-chat-profile-actions">${allowed('warn')?'<button class="btn" data-profile-action="warn">Avertir</button>':''}${allowed('ban')?'<button class="btn danger" data-profile-action="ban">Bannir</button>':''}${allowed('mute')?'<button class="btn" data-profile-action="mute">Mute temporaire</button><button class="btn" data-profile-action="unmute">Lever le mute</button>':''}<button class="btn" data-profile-action="unban">Débannir</button></div>`;
 const counts=`<div class="av-chat-panel-row"><span>Messages</span><strong>${Number(info.message_count)||0}</strong></div><div class="av-chat-panel-row"><span>Avertissements</span><strong>${Number(info.warning_count)||0}</strong></div><div class="av-chat-panel-row"><span>Bannissements</span><strong>${Number(info.ban_count)||0}</strong></div><div class="av-chat-panel-row"><span>Dernière connexion</span><small>${info.last_sign_in_at?new Date(info.last_sign_in_at).toLocaleString('fr-FR'):'—'}</small></div>`;
 const rows=profileTab==='messages'?(m.error?'<p>Historique indisponible.</p>':(m.data||[]).map(x=>'<div class="av-chat-panel-row"><div><strong>'+esc(x.content)+'</strong><small>'+new Date(x.created_at).toLocaleString('fr-FR')+'</small></div>'+(!protectedUser&&allowed('delete_messages')?'<button class="btn danger" data-profile-delete="'+x.id+'">Supprimer</button>':'')+'</div>').join('')||'<p>Aucun message.</p>'):(s.error?'<p>Historique indisponible.</p>':(s.data||[]).map(x=>'<div class="av-chat-panel-row"><div><strong>'+esc(x.action)+'</strong><small>'+esc(x.reason)+' · '+esc(x.duration||'')+' · '+new Date(x.created_at).toLocaleString('fr-FR')+'</small></div></div>').join('')||'<p>Aucune sanction.</p>');
 actions.innerHTML=counts+actionButtons+(profileTab==='messages'?'<div class="av-chat-mod-search"><input id="avChatMessageSearch" type="search" placeholder="Rechercher dans les messages" value="'+esc(searchTerm||'')+'"><button type="button" id="avChatMessageSearchBtn">Rechercher</button></div>':'')+(profileTab==='messages'&&allowed('delete_messages')&&!protectedUser?'<button class="btn danger" data-profile-delete-all="1">Supprimer tous ses messages</button>':'')+rows;actions.querySelector('#avChatMessageSearchBtn')?.addEventListener('click',loadProfile);actions.querySelector('#avChatMessageSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadProfile()}});
 actions.querySelectorAll('[data-profile-action]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.profileAction;if(a==='unban'){const reason=prompt('Motif du débannissement :')||'Réactivation demandée';moderate('unban',profileTarget,reason)}else if(a==='mute')moderate('mute',profileTarget);else if(a==='unmute')moderate('unmute',profileTarget,'Réactivation du chat');else moderate(a,profileTarget)}));
 actions.querySelectorAll('[data-profile-delete]').forEach(b=>b.addEventListener('click',()=>moderate('delete_message',profileTarget,'Suppression depuis la fiche',null,Number(b.dataset.profileDelete))));
 actions.querySelector('[data-profile-delete-all]')?.addEventListener('click',()=>confirm('Supprimer tous les messages de cette personne ?')&&moderate('delete_all',profileTarget,'Suppression de tous les messages'));
}
async function showModeratorManager(){
 const manager=$('avChatModManager');if(!manager)return;manager.hidden=permissions.role!=='super_admin';
 if(permissions.role!=='super_admin')return;
 const {data,error}=await rpc('chat_admin_list_moderators');if(error)return;
 $('avChatModeratorList').innerHTML='<h4>Modérateurs actuels</h4>'+(data||[]).map(m=>'<div class="av-chat-panel-row"><div><strong>'+esc(m.display_name)+'</strong><small>'+esc(m.email)+' · nommé le '+new Date(m.appointed_at).toLocaleDateString('fr-FR')+'</small><div class="av-chat-permission-grid">'+caps.map(([k,label])=>'<label><input type="checkbox" data-cap="'+k+'" '+(m.permissions?.[k]?'checked':'')+'> '+label+'</label>').join('')+'<label>Durée max (min) <input type="number" data-maxban value="'+Number(m.max_ban_minutes||0)+'" min="0" max="43200"></label><label><input type="checkbox" data-permanent '+(m.can_permanent_ban?'checked':'')+'> Autoriser ban définitif</label></div></div><button class="btn danger" data-remove-mod="'+esc(m.email)+'">Retirer</button><button class="btn" data-save-mod="'+esc(m.email)+'">Enregistrer les permissions</button></div>').join('')||'<p>Aucun modérateur nommé.</p>';
 $('avChatModeratorList').querySelectorAll('[data-remove-mod]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Retirer '+b.dataset.removeMod+' des modérateurs ?'))return;const {error}=await rpc('chat_admin_set_moderator',{p_email:b.dataset.removeMod,p_is_moderator:false});if(error)announce('Retrait refusé.');else showModeratorManager()}));
 $('avChatModeratorList').querySelectorAll('[data-save-mod]').forEach(b=>b.addEventListener('click',async()=>{const row=b.closest('.av-chat-panel-row'),perms={};row.querySelectorAll('[data-cap]').forEach(x=>perms[x.dataset.cap]=x.checked);const max=Number(row.querySelector('[data-maxban]')?.value||0),perm=!!row.querySelector('[data-permanent]')?.checked;const {error}=await rpc('chat_admin_set_moderator',{p_email:b.dataset.saveMod,p_is_moderator:true,p_permissions:perms,p_max_ban_minutes:max,p_can_permanent_ban:perm});announce(error?'Permissions non enregistrées.':'Permissions enregistrées.');}));
 const settings=await rpc('chat_admin_get_settings');if(!settings.error)$('avChatWarningThreshold').value=settings.data.warning_threshold;
}
async function loadReports(){
 const section=$('avChatReports');if(!section)return;
 section.hidden=!allowed('manage_reports');if(section.hidden)return;
 const {data,error}=await rpc('chat_admin_list_reports');const list=$('avChatReportList');
 list.innerHTML=error?'<p>Signalements indisponibles.</p>':(data||[]).map(r=>'<div class="av-chat-panel-row"><div><strong>Message #'+esc(r.message_id)+'</strong><small>'+esc(r.reason)+' · '+new Date(r.created_at).toLocaleString('fr-FR')+'</small></div><button class="btn primary" data-report-resolve="'+esc(r.id)+'">Traiter</button><button class="btn" data-report-dismiss="'+esc(r.id)+'">Ignorer</button></div>').join('')||'<p>Aucun signalement en attente.</p>';
 list.querySelectorAll('[data-report-resolve],[data-report-dismiss]').forEach(b=>b.addEventListener('click',async()=>{const status=b.hasAttribute('data-report-resolve')?'resolved':'dismissed';const {error}=await rpc('chat_admin_resolve_report',{p_report_id:b.dataset.reportResolve||b.dataset.reportDismiss,p_status:status});announce(error?'Impossible de mettre à jour ce signalement.':'Signalement traité.');loadReports()}));
}
async function searchUsers(){
 const q=$('avChatUserSearch')?.value?.trim();if(!q||q.length<2)return;
 const {data,error}=await rpc('chat_admin_search_users',{p_query:q});
 $('avChatSearchResults').innerHTML=error?'<p>Recherche réservée au super administrateur.</p>':(data||[]).map(x=>'<div class="av-chat-panel-row"><div><strong>'+esc(x.display_name)+'</strong><small>'+esc(x.email)+' · '+esc(x.role)+'</small></div>'+(x.role==='super_admin'?'Compte protégé':'<button class="btn primary" data-appoint="'+esc(x.email)+'">'+(x.role==='moderator'?'Mettre à jour':'Nommer modérateur')+'</button>')+'</div>').join('')||'<p>Aucun compte trouvé.</p>';
 $('avChatSearchResults').querySelectorAll('[data-appoint]').forEach(b=>b.addEventListener('click',async()=>{const email=b.dataset.appoint,perms={};caps.forEach(([k])=>perms[k]=false);const {error}=await rpc('chat_admin_set_moderator',{p_email:email,p_is_moderator:true,p_permissions:perms,p_max_ban_minutes:10080,p_can_permanent_ban:false});announce(error?'Impossible de nommer ce compte.':'Modérateur nommé. Configure ses permissions dans la liste.');showModeratorManager()}));
}
function decorateChatFlow(box=$('chatMessages')){
 if(!box)return;const rows=[...box.querySelectorAll('[data-message-id]')];let lastDay='',lastUser='';
 rows.forEach((row,i)=>{
  const date=new Date(row.querySelector('time')?.dateTime||Date.now()),key=date.toLocaleDateString('fr-CA');
  if(key!==lastDay){let sep=box.querySelector('[data-av-date-before="'+CSS.escape(row.dataset.messageId)+'"]');if(!sep){sep=document.createElement('div');sep.className='av-chat-date-sep';sep.dataset.avDateBefore=row.dataset.messageId;row.before(sep)}const d=new Date();const y=new Date();y.setDate(y.getDate()-1);sep.textContent=key===d.toLocaleDateString('fr-CA')?'Aujourd’hui':key===y.toLocaleDateString('fr-CA')?'Hier':date.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});lastDay=key}
  const same=!!(i&&rows[i-1].dataset.userId===row.dataset.userId&&new Date(rows[i-1].querySelector('time')?.dateTime||0).toLocaleDateString('fr-CA')===key);
  row.classList.toggle('av-chat-grouped',same);lastUser=row.dataset.userId||'';
  const reply=row.dataset.replyTo;if(reply&&!row.querySelector('.av-chat-reply-quote')){const target=box.querySelector('[data-message-id="'+CSS.escape(reply)+'"] .chat-text');if(target){const q=document.createElement('div');q.className='av-chat-reply-quote';q.textContent='Réponse à : '+target.textContent.slice(0,100);row.querySelector('.chat-text')?.before(q)}}
 });
 box.querySelectorAll('.av-chat-date-sep').forEach(sep=>{if(!box.querySelector('[data-message-id="'+CSS.escape(sep.dataset.avDateBefore||'')+'"]'))sep.remove()});
}
function bind(){
 assurePanel();
 document.addEventListener('click',e=>{const profile=e.target.closest('[data-chat-open-profile]');if(profile){openProfile(profile.dataset.chatOpenProfile);return}if(e.target=== $('avChatProfileBackdrop')||e.target.closest('#avChatProfileClose'))$('avChatProfileBackdrop').hidden=true});
 document.querySelectorAll('[data-profile-tab]').forEach(b=>b.addEventListener('click',()=>{profileTab=b.dataset.profileTab;document.querySelectorAll('[data-profile-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));loadProfile()}));
 $('avChatReplyCancel')?.addEventListener('click',()=>{replyTo=null;$('avChatReplyNotice').hidden=true});
 $('avChatUserSearchBtn')?.addEventListener('click',searchUsers);
 $('avChatUserSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchUsers()}});
 $('avChatSaveThreshold')?.addEventListener('click',async()=>{const n=Number($('avChatWarningThreshold').value),{error}=await rpc('chat_admin_update_settings',{p_warning_threshold:n});announce(error?'Seuil non enregistré.':'Seuil enregistré.')});
 document.addEventListener('click',e=>{const reply=e.target.closest('[data-chat-reply]');if(reply){replyTo=reply.dataset.chatReply;$('avChatReplyText').textContent='Réponse au message '+replyTo;$('avChatReplyNotice').hidden=false}});
 const box=$('chatMessages');if(box){new MutationObserver(()=>{decorateMessages(box);decorateChatFlow(box)}).observe(box,{childList:true,subtree:true})}
 $('chatForm')?.addEventListener('submit',e=>{if(!replyTo)return;const hidden=$('avChatReplyId');if(hidden)hidden.value=replyTo});
 document.addEventListener('animeverse:chat-admin-refresh',()=>{showModeratorManager();loadProfile()});['chatLogFilterAction','chatLogFilterModerator','chatLogFilterDate'].forEach(id=>$(id)?.addEventListener('change',()=>window.__animeverseLoadChatAdminPanel?.()));
 const authReady=async()=>{const bridge=window.__animeverseAssistantBridge;client=bridge?.getClient?.();user=bridge?.getUser?.();if(!client||!user){permissions={role:'member',permissions:{}};$('chatAdminPanel')?.classList.add('hidden');presenceChannel?.unsubscribe();presenceChannel=null;return}const {data,error}=await rpc('chat_my_permissions');if(error){console.warn('Chat role permissions unavailable');return}permissions=data||permissions;const panel=$('chatAdminPanel');if(panel)panel.classList.toggle('hidden',permissions.role==='member');if(permissions.role==='super_admin')showModeratorManager();loadReports();checkWarnings();startPresence()};document.addEventListener('animeverse-assistant-auth',authReady);if(window.__animeverseAssistantBridge?.ready())setTimeout(authReady,0);
 document.addEventListener('animeverse:chat-auth',()=>{const b=window.__animeverseAssistantBridge;client=b?.getClient?.();user=b?.getUser?.()});
}
async function checkWarnings(){if(!user)return;const {data,error}=await client.from('chat_warnings').select('id,reason,created_at').eq('user_id',user.id).eq('seen',false).order('created_at',{ascending:false}).limit(10);if(error||!data?.length)return;const host=$('chatNotice');if(host){host.textContent='Avertissement : '+data.map(x=>x.reason).join(' · ');host.classList.remove('hidden')}await rpc('chat_mark_warnings_seen')}
function startPresence(){if(!client||!user)return;presenceChannel?.unsubscribe();presenceChannel=client.channel('animeverse-chat-presence',{config:{presence:{key:user.id}}});presenceChannel.on('presence',{event:'sync'},()=>{const state=presenceChannel.presenceState(),entries=Object.values(state).flat(),n=Object.keys(state).length;document.querySelectorAll('.chat-online-count').forEach(x=>x.textContent=String(n));const host=$('chatOnlineMembers');if(host){host.replaceChildren();entries.slice(0,6).forEach(item=>{const b=document.createElement('span');b.className='chat-online-member';b.title=item.display_name||'Membre';b.textContent=(item.display_name||'M').slice(0,1).toUpperCase();host.appendChild(b)})}}).on('broadcast',{event:'typing'},({payload})=>{const area=$('avChatTyping');if(area&&payload?.user_id!==user.id)area.textContent=payload?.typing?(String(payload.display_name||'Un membre')+' est en train d’écrire…'):''}).subscribe(async status=>{if(status==='SUBSCRIBED')await presenceChannel.track({display_name:user.user_metadata?.username||user.email?.split('@')[0]||'Membre',online_at:new Date().toISOString()})});const input=$('chatInput');if(input&&!input.dataset.avTypingBound){input.dataset.avTypingBound='1';let timer;input.addEventListener('input',()=>{if(!presenceChannel)return;const name=user.user_metadata?.username||user.email?.split('@')[0]||'Membre';presenceChannel.send({type:'broadcast',event:'typing',payload:{user_id:user.id,display_name:name,typing:true}});clearTimeout(timer);timer=setTimeout(()=>presenceChannel?.send({type:'broadcast',event:'typing',payload:{user_id:user.id,display_name:name,typing:false}}),1800)})}}
window.__animeverseChatAdmin={getPermissions:()=>permissions,refresh:()=>{showModeratorManager();loadProfile()},setReply:id=>{replyTo=id;$('avChatReplyNotice').hidden=false}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();