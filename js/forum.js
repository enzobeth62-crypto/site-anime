(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ANILIST='https://graphql.anilist.co';
let client=null,user=null,permissions={role:'member',permissions:{}},categories=[],threads=[],activeCategory='all',activeThread=null,activePosts=[],pendingAttachments=[],quotePost=null,editPost=null,editThread=null,threadChannel=null,roleMap=new Map(),likeMap=new Map(),lastPosts=new Map(),searchTimer=null;
const allowed=key=>permissions.role==='super_admin'||(permissions.role==='moderator'&&permissions.permissions&&permissions.permissions[key]===true);
const displayName=()=>String(user?.user_metadata?.username||user?.user_metadata?.pseudo||user?.user_metadata?.display_name||'Membre').slice(0,50);
function note(message,isError=false){const n=$('forumNotice');if(!n)return;n.textContent=message;n.classList.toggle('is-error',isError);n.hidden=!message}
function db(){return client}
async function rpc(name,args){const {data,error}=await db().rpc(name,args||{});if(error)throw error;return data}
function setHome(isDetail){$('forumHome').classList.toggle('hidden',isDetail);$('forumThreadDetail').classList.toggle('hidden',!isDetail)}
function categoryName(id){return categories.find(c=>c.id===id)?.name||'Discussion'}
function cleanVideoUrl(value){try{const u=new URL(value);if(u.protocol!=='https:')return null;const host=u.hostname.toLowerCase().replace(/^www\./,'');if(host==='youtu.be'){const id=u.pathname.split('/').filter(Boolean)[0];return id&&/^[\w-]{6,20}$/.test(id)?{url:'https://youtu.be/'+id,embed:'https://www.youtube-nocookie.com/embed/'+id}:null}if(host==='youtube.com'||host==='m.youtube.com'){const id=u.searchParams.get('v')||(u.pathname.match(/\/(?:embed|shorts)\/([\w-]+)/)||[])[1];return id&&/^[\w-]{6,20}$/.test(id)?{url:'https://www.youtube.com/watch?v='+id,embed:'https://www.youtube-nocookie.com/embed/'+id}:null}if(host==='vimeo.com'){const id=u.pathname.split('/').filter(Boolean).pop();return id&&/^\d{5,15}$/.test(id)?{url:'https://vimeo.com/'+id,embed:'https://player.vimeo.com/video/'+id}:null}return null}catch(_){return null}}
function safePoster(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:''}catch(_){return ''}}
function relativeTime(value){const d=new Date(value),mins=Math.max(0,Math.floor((Date.now()-d.getTime())/60000));if(mins<1)return 'à l’instant';if(mins<60)return 'il y a '+mins+' min';const h=Math.floor(mins/60);if(h<24)return 'il y a '+h+' h';const days=Math.floor(h/24);return 'il y a '+days+' j'}
function exactDate(value){return new Date(value).toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'})}
async function loadCategories(){
 const {data,error}=await db().from('forum_categories').select('id,slug,name,description,icon,display_order').order('display_order');
 if(error)throw error;categories=data||[];
 $('forumCategory').innerHTML=categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
 renderCategoryFilters();
}
function renderCategoryFilters(){
 const host=$('forumCategoryFilters');
 host.innerHTML='<button type="button" class="forum-category-pill" data-category="all" aria-pressed="'+(activeCategory==='all')+'">Toutes</button>'+categories.map(c=>'<button type="button" class="forum-category-pill" data-category="'+esc(c.id)+'" aria-pressed="'+(activeCategory===c.id)+'">'+esc(c.name)+'</button>').join('');
}
async function loadThreads(){
 if(!client)return;
 const host=$('forumThreadList');host.innerHTML='<div class="forum-empty">Chargement des discussions…</div>';
 let query=db().from('forum_threads').select('id,author_id,author_display_name,title,category_id,tags,pinned,locked,views,last_post_id,last_post_at,created_at,updated_at,forum_categories(name,slug),last_post:forum_posts!forum_threads_last_post_id_fkey(id,author_display_name,content,created_at),post_count:forum_posts!forum_posts_thread_id_fkey(count)').is('deleted_at',null).order('pinned',{ascending:false}).order('last_post_at',{ascending:false}).limit(100);
 if(activeCategory!=='all')query=query.eq('category_id',activeCategory);
 const {data,error}=await query;
 if(error){host.innerHTML='<div class="forum-empty">Impossible de charger les sujets. Réessaie.</div>';console.error('Forum list',error);return}
 threads=data||[];lastPosts.clear();likeMap.clear();
 if(threads.length){
  const ids=threads.map(t=>t.id);
  for(const t of threads)if(t.last_post)lastPosts.set(t.id,t.last_post);
  try{const likes=await rpc('forum_get_like_counts',{p_thread_ids:ids,p_post_ids:[]});for(const l of likes||[])likeMap.set(l.target_id,l)}catch(err){console.warn('Forum likes unavailable',err)}
  try{const roles=await rpc('chat_role_badges',{p_users:[...new Set(threads.map(t=>t.author_id))]});for(const r of roles||[])roleMap.set(r.user_id,r.role)}catch(_){}
 }
 renderThreads();loadNotifications();
}
function renderThreads(){
 const term=$('forumSearch').value.trim().toLocaleLowerCase('fr'),sort=$('forumSort').value;
 let visible=threads.filter(t=>(activeCategory==='all'||t.category_id===activeCategory)&&(!term||(t.title+' '+(t.tags||[]).join(' ')+' '+(lastPosts.get(t.id)?.content||'')).toLocaleLowerCase('fr').includes(term)));
 if(sort==='popular')visible.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||((b.views||0)+(likeMap.get(b.id)?.like_count||0)*3)-((a.views||0)+(likeMap.get(a.id)?.like_count||0)*3)||new Date(b.last_post_at)-new Date(a.last_post_at));
 const host=$('forumThreadList');
 if(!visible.length){host.innerHTML='<div class="forum-empty">Aucun sujet pour ce filtre. Lance la première discussion.</div>';return}
 host.innerHTML=visible.map(t=>{
  const count=Math.max(0,Number(t.post_count?.[0]?.count||0)-1),liked=likeMap.get(t.id);
  const role=roleMap.get(t.author_id),last=lastPosts.get(t.id);
  return '<article class="forum-thread-card '+(t.pinned?'is-pinned':'')+'"><button type="button" class="forum-thread-open" data-forum-open="'+esc(t.id)+'"><span class="forum-thread-topline"><span class="forum-category-tag">'+esc(categoryName(t.category_id))+'</span>'+(t.pinned?'<span class="forum-pinned-label">Épinglé</span>':'')+(t.locked?'<span class="forum-locked-label">Verrouillé</span>':'')+'</span><span class="forum-thread-title">'+esc(t.title)+'</span><span class="forum-thread-snippet">'+esc(last?.content||'')+'</span><span class="forum-thread-tags">'+(t.tags||[]).map(tag=>'<span class="forum-tag">#'+esc(tag)+'</span>').join('')+'</span></button><footer class="forum-thread-footer"><span>Par '+esc(t.author_display_name)+(role==='super_admin'?'<b class="forum-role-badge">Admin</b>':role==='moderator'?'<b class="forum-role-badge">Modo</b>':'')+' · <time title="'+esc(exactDate(t.created_at))+'">'+esc(relativeTime(t.created_at))+'</time></span><div class="forum-thread-stats"><span>'+count+' réponse'+(count===1?'':'s')+'</span><span>'+Number(t.views||0)+' vues</span><button type="button" data-forum-like-thread="'+esc(t.id)+'" aria-pressed="'+Boolean(liked?.liked)+'">♥ '+Number(liked?.like_count||0)+'</button></div><span class="forum-last-post">'+(last?'Dernier : '+esc(last.author_display_name)+' · '+esc(relativeTime(last.created_at)):'Pas encore de réponse')+'</span></footer></article>';
 }).join('');
}
function openComposer(thread=null){
 if(!requireLogin())return;
 editThread=thread;
 pendingAttachments=[];
 $('forumThreadForm').reset();
 $('forumThreadText').required=!thread;
 $('forumCategory').innerHTML=categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
 if(thread){$('forumTitle').value=thread.title;$('forumCategory').value=thread.category_id;$('forumTags').value=(thread.tags||[]).join(', ');$('forumThreadForm').querySelector('header h3').textContent='Modifier le sujet'}
 else{$('forumThreadForm').querySelector('header h3').textContent='Ouvrir une discussion'}
 renderComposerAttachments();
 $('forumComposerDialog').showModal();
}
function closeComposer(clean=true){$('forumComposerDialog').close();if(clean)cleanupAttachments();editThread=null;pendingAttachments=[]}
function requireLogin(){if(user)return true;note('Connecte-toi pour utiliser le forum.',true);$('authOpen')?.click();return false}
async function cleanupAttachments(){const paths=pendingAttachments.filter(a=>a.type==='image').map(a=>a.path);if(paths.length&&client)await client.storage.from('forum-images').remove(paths).catch(()=>{});pendingAttachments=[]}
async function resizeImage(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choisis une image JPG, PNG ou WEBP.');
 if(file.size>10*1024*1024)throw Error('L’image doit faire moins de 10 Mo avant compression.');
 const bitmap=await createImageBitmap(file),scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.84));
 if(!blob)throw Error('Compression de l’image impossible.');
 if(blob.size>5*1024*1024)throw Error('Image compressée trop volumineuse.');
 return blob;
}
async function addImages(files){
 if(!requireLogin())return;
 for(const file of [...files]){
  if(pendingAttachments.length>=4){note('Maximum 4 pièces jointes par message.',true);break}
  try{
   const blob=await resizeImage(file),path=user.id+'/'+crypto.randomUUID()+'.webp';
   const {error}=await client.storage.from('forum-images').upload(path,blob,{contentType:'image/webp',upsert:false});
   if(error)throw error;pendingAttachments.push({type:'image',path,alt:file.name.slice(0,80)});renderComposerAttachments();
  }catch(err){note(err.message||'Image non ajoutée.',true)}
 }
}
function activePreviewHost(){return $('forumComposerDialog').open?$('forumComposerAttachments'):$('forumReplyAttachmentPreview')}
async function renderComposerAttachments(){
 const host=activePreviewHost();if(!host)return;host.innerHTML='';
 for(let i=0;i<pendingAttachments.length;i++){
  const item=pendingAttachments[i],box=document.createElement('span');box.className='forum-attachment-item';
  if(item.type==='image'){const {data}=await client.storage.from('forum-images').createSignedUrl(item.path,3600);if(data?.signedUrl){const img=document.createElement('img');img.src=data.signedUrl;img.alt=item.alt||'Image jointe';img.decoding='async';box.appendChild(img)}}
  else if(item.type==='anime'){const img=document.createElement('img');img.src=item.cover_url;img.alt=item.title;box.appendChild(img)}
  else {box.textContent=item.type==='video'?'Vidéo':'Fiche anime'}
  const remove=document.createElement('button');remove.type='button';remove.className='forum-attachment-remove';remove.textContent='×';remove.setAttribute('aria-label','Retirer cette pièce jointe');remove.addEventListener('click',async()=>{if(item.type==='image')await client.storage.from('forum-images').remove([item.path]);pendingAttachments.splice(i,1);renderComposerAttachments()});box.appendChild(remove);host.appendChild(box)
 }
}
function renderAttachment(item){
 if(item.type==='image')return client.storage.from('forum-images').createSignedUrl(item.path,3600).then(({data})=>data?.signedUrl?'<img class="forum-image-thumb" data-forum-image="'+esc(data.signedUrl)+'" src="'+esc(data.signedUrl)+'" alt="'+esc(item.alt||'Image partagée')+'" loading="lazy" decoding="async">':'<span class="forum-empty">Image indisponible</span>');
 if(item.type==='anime')return Promise.resolve('<a class="forum-anime-card" href="https://anilist.co/anime/'+encodeURIComponent(item.anilist_id)+'/" target="_blank" rel="noopener noreferrer"><img src="'+esc(item.cover_url)+'" alt="" loading="lazy" decoding="async"><span><strong>'+esc(item.title)+'</strong><br><small>'+esc(item.format||'Anime')+(item.average_score?' · Note '+(Number(item.average_score)/10).toFixed(1)+'/10':'')+'</small></span></a>');
 const video=cleanVideoUrl(item.url);if(!video)return Promise.resolve('<p>Lien vidéo non valide.</p>');
 return Promise.resolve('<div class="forum-video-embed"><iframe src="'+esc(video.embed)+'" title="Vidéo YouTube ou Vimeo" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>');
}
async function renderPost(post,quoteMap){
 const role=roleMap.get(post.author_id),own=post.author_id===user?.id,deleted=Boolean(post.deleted_at),attachments=post.attachments||[];
 let attachmentHtml='';if(!deleted&&attachments.length){attachmentHtml=(await Promise.all(attachments.map(renderAttachment))).map(x=>'<div class="forum-attachment-display">'+x+'</div>').join('')}
 const quoted=quoteMap.get(post.quote_post_id);
 let html='<article class="forum-post-card '+(deleted?'is-deleted':'')+'" data-forum-post="'+esc(post.id)+'"><header class="forum-post-meta"><span><b class="forum-author-name">'+esc(post.author_display_name)+'</b> '+(role==='super_admin'?'<b class="forum-role-badge">Admin</b>':role==='moderator'?'<b class="forum-role-badge">Modo</b>':'')+(post.edited_at&&!deleted?'<small> · modifié</small>':'')+'</span><time title="'+esc(exactDate(post.created_at))+'">'+esc(relativeTime(post.created_at))+'</time></header>'+(quoted?'<blockquote class="forum-quote">'+esc(quoted.author_display_name)+' : '+esc(quoted.content.slice(0,240))+'</blockquote>':'')+'<div class="forum-post-body">'+(deleted?'<i>Ce message a été supprimé.</i>':esc(post.content))+'</div>'+attachmentHtml;
 if(!deleted)html+='<div class="forum-post-actions"><button type="button" class="btn forum-post-like" data-forum-like-post="'+esc(post.id)+'" aria-pressed="'+Boolean(likeMap.get(post.id)?.liked)+'">♥ '+Number(likeMap.get(post.id)?.like_count||0)+'</button><button type="button" class="btn" data-forum-quote="'+esc(post.id)+'">Citer / répondre</button>'+(own?'<button type="button" class="btn" data-forum-edit-post="'+esc(post.id)+'">Modifier</button><button type="button" class="btn danger" data-forum-delete-post="'+esc(post.id)+'">Supprimer</button>':allowed('manage_forum')?'<button type="button" class="btn danger" data-forum-mod-delete-post="'+esc(post.id)+'">Supprimer</button>':'')+((allowed('warn')||allowed('ban'))&&!own?'<span class="forum-mod-actions">'+(allowed('warn')?'<button class="btn" data-forum-warn="'+esc(post.author_id)+'">Avertir</button>':'')+(allowed('ban')?'<button class="btn danger" data-forum-ban="'+esc(post.author_id)+'">Bannir</button>':'')+'</span>':'')+'</div>';
 return html+'</article>';
}
async function openThread(id,increment=true){
 const thread=threads.find(t=>t.id===id)||activeThread;if(!thread)return;
 activeThread=thread;setHome(true);$('forumThreadContent').innerHTML='<div class="forum-empty">Chargement du sujet…</div>';$('forumPosts').innerHTML='';
 if(threadChannel){await client.removeChannel(threadChannel);threadChannel=null}
 if(increment&&user)try{thread.views=await rpc('forum_increment_view',{p_thread_id:id})}catch(_){}
 const {data,error}=await client.from('forum_posts').select('id,thread_id,author_id,author_display_name,content,quote_post_id,attachments,edited_at,deleted_at,created_at,updated_at').eq('thread_id',id).order('created_at',{ascending:true});
 if(error){note('Impossible de charger les réponses.',true);return}
 activePosts=data||[];editPost=null;quotePost=null;$('forumQuoteBanner').classList.add('hidden');
 const roleIds=[...new Set([thread.author_id,...activePosts.map(p=>p.author_id)])];if(user)try{const roles=await rpc('chat_role_badges',{p_users:roleIds});for(const r of roles||[])roleMap.set(r.user_id,r.role)}catch(_){}
 likeMap.clear();try{const likes=await rpc('forum_get_like_counts',{p_thread_ids:[id],p_post_ids:activePosts.map(p=>p.id)});for(const l of likes||[])likeMap.set(l.target_id,l)}catch(_){}
 await renderThread(thread);
 threadChannel=client.channel('forum-thread-'+id).on('postgres_changes',{event:'INSERT',schema:'public',table:'forum_posts',filter:'thread_id=eq.'+id},()=>openThread(id,false)).subscribe();
 if(user)await client.from('forum_notifications').update({read_at:new Date().toISOString()}).eq('thread_id',id).eq('user_id',user.id).is('read_at',null);
}
async function renderThread(thread){
 const liked=likeMap.get(thread.id);
 $('forumThreadContent').innerHTML='<article class="forum-thread-main"><div class="forum-thread-topline"><span class="forum-category-tag">'+esc(categoryName(thread.category_id))+'</span>'+(thread.pinned?'<span class="forum-pinned-label">Épinglé</span>':'')+(thread.locked?'<span class="forum-locked-label">Verrouillé</span>':'')+'</div><h3>'+esc(thread.title)+'</h3><div class="forum-thread-topline"><span>Par '+esc(thread.author_display_name)+'</span><time title="'+esc(exactDate(thread.created_at))+'">'+esc(relativeTime(thread.created_at))+'</time></div><div class="forum-thread-tags">'+(thread.tags||[]).map(tag=>'<span class="forum-tag">#'+esc(tag)+'</span>').join('')+'</div><div class="forum-thread-body">'+esc(activePosts[0]?.content||'')+'</div><div id="forumThreadAttachments" class="forum-attachment-display"></div><div class="forum-like-row"><button type="button" class="btn forum-post-like" data-forum-like-thread="'+esc(thread.id)+'" aria-pressed="'+Boolean(liked?.liked)+'">♥ '+Number(liked?.like_count||0)+'</button><span>'+Number(thread.views||0)+' vues</span></div></article>';
 document.querySelectorAll('.forum-thread-locked-notice').forEach(x=>x.remove());
 const first=activePosts[0],main=$('forumThreadContent').querySelector('.forum-thread-main'),firstTools=document.createElement('div');firstTools.className='forum-post-actions forum-first-post-actions';
 if(first&&user&&first.author_id===user.id){const edit=document.createElement('button');edit.type='button';edit.className='btn';edit.dataset.forumEditFirst=first.id;edit.textContent='Modifier le premier message';firstTools.append(edit);const remove=document.createElement('button');remove.type='button';remove.className='btn danger';remove.dataset.forumDeleteFirst=first.id;remove.textContent='Supprimer le premier message';firstTools.append(remove)}
 if(first&&first.author_id!==user?.id){if(allowed('warn')){const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.forumWarn=first.author_id;b.textContent='Avertir l’auteur';firstTools.append(b)}if(allowed('ban')){const b=document.createElement('button');b.type='button';b.className='btn danger';b.dataset.forumBan=first.author_id;b.textContent='Bannir l’auteur';firstTools.append(b)}}
 if(first&&allowed('manage_forum')&&first.author_id!==user?.id){const b=document.createElement('button');b.type='button';b.className='btn danger';b.dataset.forumModDeletePost=first.id;b.textContent='Supprimer le premier message';firstTools.append(b)}
 if(firstTools.childElementCount)main.append(firstTools);
 if(first?.attachments?.length)renderAttachments(first.attachments).then(html=>{$('forumThreadAttachments').innerHTML=html});
 const tools=$('forumModerationTools');tools.innerHTML='';
 if(user&&thread.author_id===user.id){tools.innerHTML='<button type="button" class="btn" data-forum-edit-thread>Modifier le sujet</button><button type="button" class="btn danger" data-forum-own-delete-thread>Supprimer</button>'}
 if(allowed('manage_forum')){
  tools.innerHTML+='<button type="button" class="btn" data-forum-mod-thread="pin">'+(thread.pinned?'Désépingler':'Épingler')+'</button><button type="button" class="btn" data-forum-mod-thread="lock">'+(thread.locked?'Déverrouiller':'Verrouiller')+'</button><select id="forumMoveCategory" aria-label="Déplacer le sujet">'+categories.map(c=>'<option value="'+esc(c.id)+'" '+(c.id===thread.category_id?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select><button type="button" class="btn" data-forum-mod-thread="move">Déplacer</button><button type="button" class="btn danger" data-forum-mod-thread="delete">Supprimer le sujet</button>'
 }
 const quotes=new Map(activePosts.map(p=>[p.id,p]));
 $('forumPosts').innerHTML=(await Promise.all(activePosts.slice(1).map(p=>renderPost(p,quotes)))).join('');
 $('forumReplyForm').classList.toggle('hidden',Boolean(thread.locked)||!user);
 $('forumReplyText').disabled=!user||Boolean(thread.locked);
 if(thread.locked){const banner=document.createElement('div');banner.className='forum-notice forum-thread-locked-notice';banner.textContent='Ce sujet est verrouillé. Les réponses sont désactivées.';$('forumPosts').before(banner)}
}
async function renderAttachments(items){
 const html=await Promise.all((items||[]).map(renderAttachment));
 return html.map(x=>'<div class="forum-attachment-display">'+x+'</div>').join('');
}
async function like(targetType,id){
 if(!requireLogin())return;
 const field=targetType==='thread'?'thread_id':'post_id',existing=await client.from('forum_likes').select('id').eq(field,id).eq('user_id',user.id).maybeSingle();
 if(existing.error){note('Impossible de mettre à jour le j’aime.',true);return}
 const result=existing.data?await client.from('forum_likes').delete().eq('id',existing.data.id).eq('user_id',user.id):await client.from('forum_likes').insert({user_id:user.id,[field]:id});
 if(result.error){note('Action refusée : vérifie ta connexion ou tes permissions.',true);return}
 if(activeThread)await openThread(activeThread.id,false);else await loadThreads();
}
async function warnBan(target,action){
 if(!requireLogin())return;
 const reason=prompt(action==='warn'?'Motif de l’avertissement :':'Motif du bannissement :');if(!reason||reason.trim().length<2)return;
 let duration=null;if(action==='ban'){duration=prompt('Durée : 1h, 24h, 7d, 30d'+(permissions.can_permanent_ban?', permanent':''),'24h');if(!duration)return}
 const {error}=await client.rpc('chat_moderation_action',{p_action:action,p_target:target,p_reason:reason.trim(),p_duration:duration,p_message_id:null});
 if(error){note('Action refusée par les permissions de modération.',true);console.error('Forum moderation action',error);return}
 note(action==='warn'?'Avertissement envoyé.':'Bannissement appliqué.');
}
async function moderateThread(action){
 if(!activeThread)return;
 let args={p_thread_id:activeThread.id,p_action:action,p_category_id:action==='move'?$('forumMoveCategory').value:null};
 if(action==='delete'&&!confirm('Supprimer ce sujet et ses réponses ?'))return;
 try{await rpc('forum_moderate_thread',args);note('Action de modération enregistrée.');if(action==='delete'){setHome(false);activeThread=null}await loadThreads();if(activeThread)await openThread(activeThread.id,false)}catch(err){note('Action refusée par les permissions du forum.',true);console.error('Forum thread moderation',err)}
}
async function deletePost(id){
 if(!confirm('Supprimer ce message ?'))return;const p=activePosts.find(x=>x.id===id);if(!p)return;
 const own=p.author_id===user?.id;
 if(own){const {error}=await client.from('forum_posts').update({content:'Ce message a été supprimé.',attachments:[],deleted_at:new Date().toISOString()}).eq('id',id).eq('author_id',user.id);if(error){note('Suppression refusée.',true);return}}
 else {try{await rpc('forum_moderate_post',{p_post_id:id,p_action:'delete'})}catch(err){note('Suppression refusée par les permissions du forum.',true);return}}
 await openThread(activeThread.id,false);loadThreads();
}
async function openEditPost(id){const p=activePosts.find(x=>x.id===id);if(!p)return;editPost=p;quotePost=p.quote_post_id;pendingAttachments=[...(p.attachments||[])];$('forumReplyText').value=p.content;$('forumReplySubmit').textContent='Enregistrer';if(quotePost){$('forumQuoteLabel').textContent='Citation conservée';$('forumQuoteBanner').classList.remove('hidden')}await renderComposerAttachments();$('forumReplyText').focus()}
function setQuote(id){quotePost=id;const p=activePosts.find(x=>x.id===id);$('forumQuoteLabel').textContent='En réponse à '+(p?.author_display_name||'un message');$('forumQuoteBanner').classList.remove('hidden');$('forumReplyText').focus()}
async function submitReply(event){
 event.preventDefault();if(!requireLogin()||!activeThread)return;
 const content=$('forumReplyText').value.trim();if(!content)return;
 const btn=$('forumReplySubmit');btn.disabled=true;
 try{
  if(editPost){const {error}=await client.from('forum_posts').update({content,attachments:pendingAttachments}).eq('id',editPost).eq('author_id',user.id);if(error)throw error}
  else {const {error}=await client.from('forum_posts').insert({thread_id:activeThread.id,author_id:user.id,author_display_name:displayName(),content,quote_post_id:quotePost,attachments:pendingAttachments});if(error)throw error}
  $('forumReplyText').value='';$('forumReplyForm').querySelector('label').textContent='Ta réponse';$('forumReplySubmit').textContent='Répondre';editPost=null;quotePost=null;pendingAttachments=[];$('forumQuoteBanner').classList.add('hidden');await openThread(activeThread.id,false);await loadThreads();note('Réponse publiée.');
 }catch(err){console.error('Forum reply',err);note(err.code==='42501'?'Tu ne peux pas publier actuellement.':'Impossible de publier la réponse. Vérifie la configuration Supabase.',true)}
 finally{btn.disabled=false}
}
async function submitThread(event){
 event.preventDefault();if(!requireLogin())return;
 const title=$('forumTitle').value.trim(),content=$('forumThreadText').value.trim(),categoryId=$('forumCategory').value;
 const tags=[...new Set($('forumTags').value.split(',').map(x=>x.trim().replace(/^#/,'').slice(0,30)).filter(Boolean))].slice(0,8);
 if(title.length<5||(!editThread&&!content)){note('Ajoute un titre et le contenu du sujet.',true);return}
 const btn=$('forumThreadSubmit');btn.disabled=true;
 try{
  if(editThread){const {error}=await client.from('forum_threads').update({title,category_id:categoryId,tags}).eq('id',editThread.id).eq('author_id',user.id);if(error)throw error;const id=editThread.id;closeComposer(false);await loadThreads();await openThread(id,false)}
  else {const id=await rpc('forum_create_thread',{p_title:title,p_category_id:categoryId,p_tags:tags,p_content:content,p_attachments:pendingAttachments,p_author_display_name:displayName()});const threadId=typeof id==='string'?id:id?.id;closeComposer(false);await loadThreads();if(threadId)await openThread(threadId,false);note('Sujet publié.')}
 }catch(err){console.error('Forum create topic',err);note(err.code==='42501'?'Tu ne peux pas publier actuellement.':'Impossible de publier le sujet. Vérifie la configuration Supabase.',true)}
 finally{btn.disabled=false}
}
async function addVideoAttachment(){
 const raw=$('forumVideoUrl').value.trim(),video=cleanVideoUrl(raw);if(!video){note('Le lien doit être une vidéo YouTube ou Vimeo valide.',true);return}
 if(pendingAttachments.length>=4){note('Maximum 4 pièces jointes par message.',true);return}
 pendingAttachments.push({type:'video',url:video.url});$('forumVideoDialog').close();$('forumVideoUrl').value='';renderComposerAttachments();
}
async function searchAnime(){
 const query=$('forumAnimeSearch').value.trim();if(query.length<2)return;
 $('forumAnimeResults').innerHTML='<div class="forum-empty">Recherche AniList…</div>';
 try{
  const res=await fetch(ANILIST,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query:'query($search:String){Page(perPage:6){media(search:$search,type:ANIME){id title{userPreferred romaji english} coverImage{large} seasonYear episodes format averageScore}}}',variables:{search:query}})});
  if(!res.ok)throw Error('AniList');const data=await res.json(),items=data.data?.Page?.media||[];
  $('forumAnimeResults').innerHTML=items.map(a=>{const title=a.title?.userPreferred||a.title?.english||a.title?.romaji||'Anime';return '<div class="forum-anime-result"><img src="'+esc(safePoster(a.coverImage?.large))+'" alt="" loading="lazy"><span><b>'+esc(title)+'</b><br><small>'+esc(a.seasonYear||'')+(a.episodes?' · '+esc(a.episodes)+' épisodes':'')+' · '+esc(a.format||'ANIME')+'</small></span><button type="button" class="btn" data-forum-add-anime="'+esc(a.id)+'">Ajouter</button></div>'}).join('')||'<div class="forum-empty">Aucun anime trouvé.</div>';
  $('forumAnimeResults').querySelectorAll('[data-forum-add-anime]').forEach((btn,i)=>btn.addEventListener('click',()=>{const a=items[i],title=a.title?.userPreferred||a.title?.english||a.title?.romaji||'Anime';if(pendingAttachments.length>=4){note('Maximum 4 pièces jointes par message.',true);return}pendingAttachments.push({type:'anime',anilist_id:String(a.id),title,cover_url:safePoster(a.coverImage?.large),format:a.format||'',average_score:a.averageScore||null});$('forumAnimeDialog').close();renderComposerAttachments()}));
 }catch(err){$('forumAnimeResults').innerHTML='<div class="forum-empty">La recherche AniList est indisponible. Réessaie.</div>'}
}
async function loadNotifications(){
 if(!user){$('forumNotifications').classList.add('hidden');return}
 const {data,error}=await client.from('forum_notifications').select('id,thread_id,post_id,notification_type,created_at').eq('user_id',user.id).is('read_at',null).order('created_at',{ascending:false}).limit(8);
 if(error||!data?.length){$('forumNotifications').classList.add('hidden');return}
 $('forumNotifications').innerHTML='<strong>Nouvelles réponses</strong>'+data.map(n=>'<div class="forum-notification"><button type="button" data-forum-notification="'+esc(n.thread_id)+'">'+(n.notification_type==='post_reply'?'Quelqu’un a répondu à un message que tu as cité.':'Quelqu’un a répondu à ton sujet.')+' · '+esc(relativeTime(n.created_at))+'</button></div>').join('');
 $('forumNotifications').classList.remove('hidden');
}
function renderThreadModerationRefresh(){loadThreads();if(activeThread)openThread(activeThread.id,false)}
function bind(){
 $('forumLogin').addEventListener('click',()=>$('authOpen')?.click());
 $('forumNewThread').addEventListener('click',()=>openComposer());
 $('forumComposerClose').addEventListener('click',()=>closeComposer(true));$('forumComposerCancel').addEventListener('click',()=>closeComposer(true));
 $('forumComposerDialog').addEventListener('cancel',()=>{cleanupAttachments();editThread=null});
 $('forumThreadForm').addEventListener('submit',submitThread);
 $('forumThreadForm').addEventListener('reset',()=>{pendingAttachments=[]});
 $('forumBack').addEventListener('click',async()=>{if(threadChannel){await client.removeChannel(threadChannel);threadChannel=null}activeThread=null;setHome(false);loadThreads()});
 $('forumReplyForm').addEventListener('submit',submitReply);
 $('forumCancelQuote').addEventListener('click',()=>{quotePost=null;editPost=null;$('forumQuoteBanner').classList.add('hidden');$('forumReplySubmit').textContent='Répondre'});
 $('forumCategoryFilters').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;activeCategory=b.dataset.category;renderCategoryFilters();loadThreads()});
 $('forumSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderThreads,220)});
 $('forumSort').addEventListener('change',renderThreads);
 $('forumAnimeClose').addEventListener('click',()=>$('forumAnimeDialog').close());
 $('forumAnimeSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchAnime,280)});
 $('forumVideoDialog').addEventListener('close',()=>{});
 $('forumVideoClose').addEventListener('click',()=>$('forumVideoDialog').close());$('forumVideoCancel').addEventListener('click',()=>$('forumVideoDialog').close());$('forumVideoAdd').addEventListener('click',addVideoAttachment);
 document.addEventListener('click',async e=>{
  const img=e.target.closest('[data-forum-image]');if(img){const dialog=document.createElement('dialog');dialog.className='forum-image-dialog';const close=document.createElement('button');close.className='forum-close';close.type='button';close.textContent='×';close.setAttribute('aria-label','Fermer');const picture=document.createElement('img');picture.src=img.dataset.forumImage;picture.alt=img.alt;dialog.append(close,picture);document.body.append(dialog);close.addEventListener('click',()=>dialog.close());dialog.addEventListener('click',ev=>{if(ev.target===dialog)dialog.close()});dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return}
  if(e.target.closest('[data-forum-image-trigger]')){$('forumImageInput').click();return}
  if(e.target.closest('[data-forum-video-trigger]')){$('forumVideoDialog').showModal();return}
  if(e.target.closest('[data-forum-anime-trigger]')){$('forumAnimeDialog').showModal();$('forumAnimeSearch').focus();return}
  const open=e.target.closest('[data-forum-open]');if(open){await openThread(open.dataset.forumOpen);return}
  const threadLike=e.target.closest('[data-forum-like-thread]');if(threadLike){await like('thread',threadLike.dataset.forumLikeThread);return}
  const postLike=e.target.closest('[data-forum-like-post]');if(postLike){await like('post',postLike.dataset.forumLikePost);return}
  const quote=e.target.closest('[data-forum-quote]');if(quote){setQuote(quote.dataset.forumQuote);return}
  const edit=e.target.closest('[data-forum-edit-post]');if(edit){await openEditPost(edit.dataset.forumEditPost);return}
  const del=e.target.closest('[data-forum-delete-post]');if(del){await deletePost(del.dataset.forumDeletePost);return}
  const warn=e.target.closest('[data-forum-warn]');if(warn){await warnBan(warn.dataset.forumWarn,'warn');return}
  const ban=e.target.closest('[data-forum-ban]');if(ban){await warnBan(ban.dataset.forumBan,'ban');return}
  const modPost=e.target.closest('[data-forum-mod-delete-post]');if(modPost){if(confirm('Supprimer ce message par modération ?')){try{await rpc('forum_moderate_post',{p_post_id:modPost.dataset.forumModDeletePost,p_action:'delete'});await openThread(activeThread.id,false);await loadThreads()}catch(_){note('Suppression refusée par les permissions.',true)}}return}
  const mod=e.target.closest('[data-forum-mod-thread]');if(mod){await moderateThread(mod.dataset.forumModThread);return}
  if(e.target.closest('[data-forum-own-delete-thread]')){if(!confirm('Supprimer ce sujet et toutes ses réponses ?'))return;const {error}=await client.from('forum_threads').update({deleted_at:new Date().toISOString()}).eq('id',activeThread.id).eq('author_id',user.id);if(error)note('Suppression refusée.',true);else{activeThread=null;setHome(false);await loadThreads()}return}
  if(e.target.closest('[data-forum-edit-thread]')){openComposer(activeThread);return}
  const editFirst=e.target.closest('[data-forum-edit-first]');if(editFirst){await openEditPost(editFirst.dataset.forumEditFirst);return}
  const deleteFirst=e.target.closest('[data-forum-delete-first]');if(deleteFirst){await deletePost(deleteFirst.dataset.forumDeleteFirst);return}
  const notification=e.target.closest('[data-forum-notification]');if(notification){await openThread(notification.dataset.forumNotification);return}
 });
 $('forumImageInput').addEventListener('change',async e=>{await addImages(e.target.files);e.target.value=''});
 const b=window.__animeverseAssistantBridge;
 async function authChanged(){
  const bridge=window.__animeverseAssistantBridge;client=bridge?.getClient?.();user=bridge?.getUser?.();
  $('forumAuthPrompt').classList.toggle('hidden',!!user);
  if(user&&client){try{permissions=await rpc('chat_my_permissions')}catch(_){permissions={role:'member',permissions:{}}}await loadCategories().catch(err=>{console.error('Forum categories',err);note('Le forum doit être configuré dans Supabase.',true)});await loadThreads()}
  else if(client){permissions={role:'member',permissions:{}};await loadCategories().catch(()=>{});await loadThreads()}
  else $('forumThreadList').innerHTML='<div class="forum-empty">Connexion Supabase non configurée.</div>';
 }
 window.addEventListener('animeverse-assistant-auth',authChanged);
 if(b?.ready())setTimeout(authChanged,0);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();