// =========================================================
// HMS MASTER JAVASCRIPT
// COMPLETE HOSPITAL MANAGEMENT SYSTEM
// UPDATED VERSION
// =========================================================

// =========================================================
// HMS ROLE ACCESS CONTROL
// =========================================================

// Role is resolved once from /api/auth/me. Module loaders wait for it before
// calling APIs, preventing hidden panels from issuing forbidden requests.
window.__hmsAuthRole = null;
let __hmsAuthRoleResolve;
window.__hmsAuthReady = new Promise(resolve => { __hmsAuthRoleResolve = resolve; });
async function hmsWaitForAuthRole() {
  if (window.__hmsAuthRole) return window.__hmsAuthRole;
  return await window.__hmsAuthReady;
}
function hmsRoleMayCall(endpoint) {
  const role = String(window.__hmsAuthRole || '').toLowerCase();
  const access = {
    '/api/triage/queue': ['nurse', 'receptionist', 'opd', 'doctor'],
    '/api/laboratory/patients-for-release': ['labtech', 'doctor', 'nurse'],
    '/api/doctor/nursing-rounds/patients': ['doctor', 'nurse'],
    '/api/department-communication/accounts-dispensing': ['accountant', 'accounts', 'accounts_officer', 'finance', 'finance_officer', 'hospital_manager', 'system_admin'],
    '/api/office/guidance': ['guidance_counselor', 'counselor', 'system_admin'],
    '/api/office/procurement': ['procurement_officer', 'system_admin']
  };
  const prefix = Object.keys(access).find(key => endpoint === key || endpoint.startsWith(key + '/'));
  return prefix ? access[prefix].includes(role) : true;
}

const HMS_ROLE_ACCESS = {
  // Only System Admin receives system administration access.
  system_admin: [
    'admin'
  ],

  // Hospital Manager is restricted to Hospital Administration only.
  hospital_manager: [
    'dash'
  ],

  doctor: [
    'doctor'
  ],

  // Nurses only get the Nursing module. OPD has its own role and login.
  nurse: [
    'nurse'
  ],

  labtech: [
    'lab'
  ],

  pharmacist: [
    'pharmacy'
  ],

  radiologist: [
    'radiology'
  ],

  surgeon: [
    'theatre'
  ],

  // OPD opens in the same HMS workspace as every other module.
  opd: [
    'reception'
  ],

  // Legacy receptionist accounts open the shared HMS workspace.
  receptionist: [
    'reception'
  ],

  // The former OPD-labelled accountant module is Finance.
  accountant: ['opd'],
  secretary: [],
  procurement_officer: ['procurement'],
  guidance_counselor: ['guidance-counseling'],
  counselor: ['guidance-counseling']
};

// Every workspace is intended to be a sibling under .content-area. A stray
// closing tag in the large template can otherwise nest later modules inside
// a hidden earlier module, making those routes render as empty pages.
function normalizeHmsModuleRoots() {
  const contentArea = document.querySelector('.content-area');
  if (!contentArea) return;
  const modules = Array.from(contentArea.querySelectorAll('.module-view'));
  modules.forEach(module => {
    if (module.parentElement !== contentArea) {
      contentArea.appendChild(module);
    }
  });
}

normalizeHmsModuleRoots();

// =========================================================
// NORMALIZE ROLE
// =========================================================

function normalizeHMSRole(role) {

  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

}

// =========================================================
// GET CURRENT LOGGED-IN HMS USER
// SERVER SESSION / DATABASE SYNCHRONIZED
// ROLE NORMALIZED THROUGH CANONICAL ROLE SYSTEM
// =========================================================

function getLoggedInUser() {

    try {

        // -----------------------------------------------------
        // SERVER-AUTHENTICATED USER IS STORED IN HMS STATE
        // -----------------------------------------------------

        if (
            typeof state !== 'undefined' &&
            state.currentUser &&
            typeof state.currentUser === 'object'
        ) {

            const user = {
                ...state.currentUser
            };

            // -------------------------------------------------
            // READ ROLE FROM DATABASE USER OBJECT
            // -------------------------------------------------

            const rawRole =
                user.role ||
                user.user_role ||
                user.userRole ||
                '';

            if (!rawRole) {

                console.warn(
                    'HMS: Current authenticated user has no role.',
                    user
                );

                return null;
            }

            // -------------------------------------------------
            // NORMALIZE ROLE
            //
            // getCanonicalHMSRole() already handles:
            //
            // admin
            // Admin
            // ADMIN
            // administrator
            // Administrator
            // system admin
            // system administrator
            //
            // and converts them to:
            //
            // admin
            // -------------------------------------------------

            const canonicalRole =
                getCanonicalHMSRole(rawRole);

            if (!canonicalRole) {

                console.warn(
                    'HMS: Unable to determine canonical role.',
                    rawRole
                );

                return null;
            }

            // -------------------------------------------------
            // RETURN COMPLETE USER WITH NORMALIZED ROLE
            // -------------------------------------------------

            return {
                ...user,
                role: canonicalRole
            };
        }

        // -----------------------------------------------------
        // NO SERVER-AUTHENTICATED USER
        // -----------------------------------------------------

        console.warn(
            'HMS: No server-authenticated user in HMS state.'
        );

        return null;

    } catch (error) {

        console.error(
            'HMS: Unable to read current HMS user:',
            error
        );

        return null;
    }
}
// =========================================================
// GET MODULES ALLOWED FOR CURRENT ROLE
// =========================================================

function getAllowedModules() {

  const user =
    getLoggedInUser();

  if (!user) {
    return [];
  }

  const role =
    getCanonicalHMSRole(
      user.role
    );

  // -------------------------------------------------------
  // ADMIN
  // -------------------------------------------------------

  // -------------------------------------------------------
  // ALL OTHER ROLES
  // -------------------------------------------------------

  return HMS_ROLE_ACCESS[role] || [];

}
// =========================================================
// CHECK MODULE ACCESS
// =========================================================

function hasModuleAccess(moduleId) {

  return getAllowedModules()
    .includes(moduleId);

}

// =========================================================
// ROLE-BASED DEFAULT MODULE
// =========================================================

function getPreferredHMSModule(role) {
    const canonicalRole = getCanonicalHMSRole(role);

    const preferred = {
        system_admin: 'admin',
        hospital_manager: 'dash',
        receptionist: 'reception',
        nurse: 'nurse',
        opd: 'reception',
        accountant: 'opd',
        doctor: 'doctor',
        labtech: 'lab',
        pharmacist: 'pharmacy',
        radiologist: 'radiology',
        surgeon: 'theatre',
        secretary: 'dash',
        procurement_officer: 'procurement',
        guidance_counselor: 'guidance-counseling',
        counselor: 'guidance-counseling'
    };

    return preferred[canonicalRole] || 'dash';
}

// =========================================================
// HMS HOME LAUNCHER NAVIGATION
// ALL MODULES VISIBLE
// ONLY AUTHORIZED MODULES ACTIVE
// =========================================================

async function renderNav() {

    const navContainer =
        document.getElementById('nav-container') ||
        document.getElementById('sidebar-menu');

    if (!navContainer) {

        console.warn(
            'HMS: Navigation container not found.'
        );

        return;
    }


    try {

        // =====================================================
        // GET AUTHENTICATED USER FROM FLASK SESSION
        // =====================================================

        const response = await fetch(
            '/api/auth/me',
            {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store'
            }
        );

        if (!response.ok) {

            console.error(
                'HMS: No AUTH FAILURE -/api/auth/ me returned:',
                response.status,
                response.statusText
            );
            if (response.status === 401 || response.status === 403) {
                window.location.replace('/login');
            }
            return;
        }

        const data =
            await response.json();

        if (
            !data.success ||
            !data.authenticated ||
            !data.user
        ) {

            console.error(
                'HMS: AUTH DATA INVALID:',
                data
            );
            return;
        }

        // =====================================================
        // DATABASE USER
        // =====================================================

        const user = {
            ...data.user
        };

        // =====================================================
        // NORMALIZE DATABASE ROLE
        //
        // Admin
        // administrator
        // Administrator
        // ADMIN
        //
        // all become:
        //
        // admin
        // =====================================================

        const role =
            getCanonicalHMSRole(
                user.role ||
                user.user_role ||
                user.userRole ||
                ''
            );

        if (!role) {

            console.error(
                'HMS: Authenticated user has no valid role.',
                user
            );

            window.location.replace('/login');
            return;
        }

        user.role = role;

        const activeRoleLabel = document.querySelector('#hms-main-header .hms-active-label');
        if (activeRoleLabel) {
            const roleNames = {
                system_admin: 'System Admin',
                hospital_manager: 'Hospital Manager',
                accountant: 'Finance Officer',
                accounts: 'Finance Officer',
                guidance_counselor: 'Counselor',
                labtech: 'Laboratory Technician',
                procurement_officer: 'Procurement Officer'
            };
            activeRoleLabel.textContent = roleNames[role] || role.replaceAll('_', ' ');
        }

        console.log(
            'HMS DATABASE USER:',
            user
        );

        console.log(
            'HMS DATABASE ROLE:',
            role
        );

        // =====================================================
        // SAVE AUTHENTICATED USER TO FRONTEND STATE
        // =====================================================

        state.currentUser = user;
        const departmentSwitcher = document.getElementById('hms-department-switcher');
        const departmentSwitcherWrap = document.getElementById('hms-department-switcher-wrap');
        if (departmentSwitcher && departmentSwitcherWrap) {
            try {
                const departmentResponse = await fetch('/api/auth/department', { credentials: 'same-origin', cache: 'no-store' });
                const departmentData = await departmentResponse.json().catch(() => ({}));
                if (departmentResponse.ok && departmentData.success && departmentData.departments?.length) {
                    departmentSwitcher.innerHTML = departmentData.departments.map(department =>
                        `<option value="${Number(department.id)}">${escapeHTML(department.name)}</option>`
                    ).join('');
                    departmentSwitcher.value = String(user.department_id || departmentData.department_id || '');
                    departmentSwitcherWrap.hidden = false;
                    departmentSwitcher.addEventListener('change', async () => {
                        departmentSwitcher.disabled = true;
                        try {
                            const response = await fetch('/api/auth/department', {
                                method: 'POST', credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                                body: JSON.stringify({ department_id: departmentSwitcher.value })
                            });
                            const result = await response.json().catch(() => ({}));
                            if (!response.ok || !result.success) throw new Error(result.error || 'Department change failed.');
                            if (state.activeModule) sessionStorage.setItem('hms-active-module', state.activeModule);
                            if (typeof window.releaseHmsPatientClaims === 'function') await window.releaseHmsPatientClaims();
                            window.location.reload();
                        } catch (error) {
                            alert(error.message);
                            departmentSwitcher.value = String(user.department_id || '');
                            departmentSwitcher.disabled = false;
                        }
                    });
                }
            } catch (error) {
                console.warn('HMS department switcher could not load:', error);
            }
        }
        const departmentLabel = document.getElementById('current-department-label');
        if (departmentLabel) {
            departmentLabel.textContent = user.department_name
                ? `Workspace: ${user.department_name}`
                : '';
        }
        window.__hmsAuthRole = role;
        if (typeof __hmsAuthRoleResolve === 'function') __hmsAuthRoleResolve(role);

        // =====================================================
        // DETERMINE WHICH MODULES THIS ROLE MAY ACCESS
        // =====================================================

        let allowedModules = [];

        allowedModules = HMS_ROLE_ACCESS[role] || [];

        console.log(
            'HMS ALLOWED MODULES:',
            allowedModules
        );

        // =====================================================
        // RENDER EVERY NAVIGATION ITEM
        //
        // IMPORTANT:
        // DO NOT FILTER THE MODULES.
        //
        // Every module remains visible.
        // Only authorized modules are enabled.
        // =====================================================

        // Avoid duplicate sidebar buttons if navigation is initialized again.
        navContainer.innerHTML = '';

        state.modules.forEach(
            module => {

                const allowed =
                    allowedModules.includes(
                        module.id
                    );

                // Keep the home launcher focused on modules available to
                // this account instead of showing a grid of disabled tiles.
                if (!allowed) return;

                const button =
                    document.createElement('button');

                button.type = 'button';

                button.className =
                    'nav-btn';

                button.dataset.module =
                    module.id;

                button.innerHTML = `
                    <span class="nav-icon">
                        ${module.icon || ''}
                    </span>

                    <span class="nav-label">
                        ${escapeHTML(module.name)}
                        <small class="nav-sub">${allowed ? 'Open module' : 'No access'}</small>
                    </span>
                `;

                // =================================================
                // AUTHORIZED MODULE
                // =================================================

                if (allowed) {

                    button.disabled = false;

                    button.classList.add(
                        'nav-authorized'
                    );

                    button.setAttribute(
                        'aria-disabled',
                        'false'
                    );

                    button.addEventListener(
                        'click',
                        function () {

                            switchModule(
                                module.id,
                                module.name,
                                button
                            );
                        }
                    );

                }

                // =================================================
                // UNAUTHORIZED MODULE
                // =================================================

                else {

                    button.disabled = true;

                    button.classList.add(
                        'nav-disabled'
                    );

                    button.setAttribute(
                        'aria-disabled',
                        'true'
                    );

                    button.title =
                        'You are not authorized to access this module.';

                    // Make the inactive state visually obvious.
                    button.style.opacity = '0.45';
                    button.style.cursor = 'not-allowed';
                }

                // =================================================
                // EVERY MODULE IS ADDED TO THE SIDEBAR
                // =================================================

                navContainer.appendChild(
                    button
                );
            }
        );

        // =====================================================
        // HOME LAUNCHER
        //
        // Users with several modules land on the Home launcher and
        // open each module from its own tile. A user with exactly one
        // authorized module is taken straight into it.
        // =====================================================

        const authorizedModules =
            state.modules.filter(
                module =>
                    allowedModules.includes(module.id)
            );

        if (authorizedModules.length === 0) {
            hmsFillHomeHero(user, 0);
            navContainer.innerHTML = '<section class="hms-role-empty-state"><strong>No workspace is configured for this account role.</strong><span>Ask a system administrator to review the saved user role and module access.</span></section>';
            showHmsHome();
            return;
        }

        const rememberedModule = sessionStorage.getItem('hms-active-module');
        const rememberedDefinition = authorizedModules.find(module => module.id === rememberedModule);
        if (rememberedDefinition) {
            sessionStorage.removeItem('hms-active-module');
            switchModule(rememberedDefinition.id, rememberedDefinition.name, navContainer.querySelector(`[data-module="${rememberedDefinition.id}"]`));
            return;
        }

        if (authorizedModules.length === 1) {

            const only = authorizedModules[0];

            switchModule(
                only.id,
                only.name,
                navContainer.querySelector(
                    `[data-module="${only.id}"]`
                )
            );

        } else {

            hmsFillHomeHero(user, authorizedModules.length);
            showHmsHome();
        }

    } catch (error) {

    console.error(
        'HMS RENDER NAV ERROR — DO NOT REDIRECT:',
        error
    );

    console.error(
        'HMS CURRENT URL:',
        window.location.href
    );

    console.error(
        'HMS STATE USER:',
        typeof state !== 'undefined'
            ? state.currentUser
            : 'state unavailable'
    );

    // IMPORTANT:
    // Do NOT redirect here.
    // We need the actual error to remain visible.
    }
}
// =========================================================
// Reserve each selected patient across modules so only one staff account can
// work with that patient at a time. Claims are renewed while still selected
// and released when the control is cleared or changed.
(function installPatientSelectionClaims(){
  const endpoint='/api/patient-claims';
  const active=new Map();
  const replayed=new WeakSet();
  function moduleFor(id,control=null){
    const key=String(id||'').toLowerCase();
    if(key.startsWith('doc-'))return 'doctor';
    if(key.startsWith('nurse-'))return 'nurse';
    if(key.startsWith('lab-'))return 'lab';
    if(key.startsWith('pharm-'))return 'pharmacy';
    if(key.startsWith('radiology-'))return 'radiology';
    if(key.startsWith('ot-'))return 'theatre';
    if(key.startsWith('emergency-'))return 'emergency';
    if(key.startsWith('triage-'))return 'triage';
    if(key.startsWith('reception-'))return 'reception';
    if(key.startsWith('opd-'))return 'opd';
    if(key.startsWith('acc-'))return 'accounts';
    if(key.startsWith('admin-'))return 'administration';
    if(key.startsWith('medical-report-'))return 'medical-reports';
    if(key.startsWith('gc'))return 'guidance-counseling';
    if(key.startsWith('patient-match-'))return 'reception';
    if(key==='journey-doctor')return 'doctor';
    if(key==='journey-admin')return 'administration';
    const viewId=String(control?.closest?.('.module-view')?.id||'').replace(/^mod-/,'');
    const moduleAliases={dash:'administration',admin:'administration',accounts:'accounts','medical-report':'medical-reports'};
    return moduleAliases[viewId]||viewId||'doctor';
  }
  function patientId(option){
    const value=String(option?.dataset?.databasePatientId||option?.value||'').trim();
    if(/^\d+$/.test(value))return value;
    const datasetValue=String(option?.dataset?.patientId||'').trim();
    return /^\d+$/.test(datasetValue)?datasetValue:'';
  }
  function isPatientControl(el){
    if(el instanceof HTMLSelectElement)return /patient|client/i.test((el.id||'')+' '+Array.from(el.labels||[]).map(label=>label.textContent).join(' '));
    if(!(el instanceof HTMLInputElement))return false;
    const labelText=Array.from(el.labels||[]).map(label=>label.textContent).join(' ');
    return el.id==='doc-nursing-round-patient'||(el.hasAttribute('list')&&/patient|client/i.test((el.id||'')+' '+(el.getAttribute('aria-label')||'')+' '+labelText));
  }
  function currentPatientId(control){
    if(control instanceof HTMLSelectElement)return patientId(control.options[control.selectedIndex]);
    const list=document.getElementById(control.getAttribute('list')||'');
    return patientId(Array.from(list?.options||[]).find(option=>option.value===control.value));
  }
  async function api(path='',options={}){
    const response=await fetch(endpoint+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.success===false)throw new Error(data.error||'Patient selection could not be reserved.');
    return data;
  }
  async function refreshOptions(select){
    try{
      const data=await api('?module='+encodeURIComponent(moduleFor(select.id,select)));
      const claims=new Map((data.claims||[]).map(claim=>[String(claim.patient_id),claim]));
      const options=select instanceof HTMLSelectElement?Array.from(select.options):Array.from(document.getElementById(select.getAttribute('list')||'')?.options||[]);
      options.forEach(option=>{
        if(!option.value)return;
        if(option.dataset.claimBaseDisabled===undefined)option.dataset.claimBaseDisabled=option.disabled?'1':'0';
        if(option.dataset.claimBaseText===undefined)option.dataset.claimBaseText=option.textContent;
        const claim=claims.get(patientId(option)),blocked=!!claim&&!claim.mine;
        option.disabled=option.dataset.claimBaseDisabled==='1'||blocked;
        option.textContent=blocked?`${option.dataset.claimBaseText} — selected by another staff member`:option.dataset.claimBaseText;
      });
    }catch(error){console.warn('Patient availability could not be refreshed:',error.message);}
  }
  async function releaseIfUnused(id,module,exceptControl){
    if(!id)return;
    for(const [controlId,selection] of active){
      if(controlId===exceptControl||selection.patientId!==id||selection.module!==module)continue;
      if(selection.persistent)return;
      const control=document.getElementById(controlId);
      if(control&&currentPatientId(control)===id&&moduleFor(controlId)===module)return;
    }
    try{await api('/'+encodeURIComponent(module)+'/'+encodeURIComponent(id),{method:'DELETE'});}catch(error){console.warn('Patient selection release failed:',error.message);}
  }
  window.releaseHmsPatientClaims = async function(){
    const selections = Array.from(active.values());
    active.clear();
    await Promise.all(selections.map(selection =>
      api('/'+encodeURIComponent(selection.module)+'/'+encodeURIComponent(selection.patientId),{method:'DELETE'}).catch(error => console.warn('Patient selection release failed:',error.message))
    ));
  };
  document.addEventListener('focusin',event=>{if(isPatientControl(event.target))refreshOptions(event.target);},true);
  document.addEventListener('click',async event=>{
    if(replayed.has(event))return;
    const button=event.target.closest?.('button');
    if(!button)return;
    // Patient Files is read-only; searching for a record must not enter the
    // operational patient-lock flow used by editable module forms.
    if(button.closest('.hms-role-patient-files-tabs'))return;
    const patientAttr=Array.from(button.attributes).find(attr=>attr.name.startsWith('data-')&&/patient[-_]?id/i.test(attr.name)&&attr.name!=='data-dashboard-patient-id');
    if(!button.hasAttribute('data-patient-match-index')&&!patientAttr)return;
    const isReception=button.hasAttribute('data-patient-match-index');
    const key=isReception?'patient-match-reception':button.hasAttribute('data-doctor-hms-patient-id')?'journey-doctor':button.hasAttribute('data-hms-patient-id')?'journey-admin':'patient-button-'+moduleFor('',button);
    const id=String(button.dataset.patientId||button.dataset.hmsPatientId||button.dataset.doctorHmsPatientId||patientAttr?.value||'');
    if(!id)return;
    event.preventDefault();event.stopImmediatePropagation();event.stopPropagation();
    const old=active.get(key);
    try{
      const module=moduleFor(key,button);
      await api('',{method:'POST',body:JSON.stringify({patient_id:id,module})});
      active.set(key,{patientId:id,optionValue:id,module,renewedAt:Date.now(),persistent:true});
      if(old?.patientId&&old.patientId!==id)await releaseIfUnused(old.patientId,old.module,key);
      const next=new MouseEvent('click',{bubbles:true,cancelable:true});replayed.add(next);button.dispatchEvent(next);
    }catch(error){alert(error.message);}
  },true);
  document.addEventListener('input',event=>{
    const input=event.target;
    if(!['hms-patient-file-search','doc-patient-file-search'].includes(input?.id)||input.value.trim())return;
    const key=input.id==='doc-patient-file-search'?'journey-doctor':'journey-admin',selection=active.get(key);
    if(selection){active.delete(key);releaseIfUnused(selection.patientId,selection.module,key);}
  },true);
  document.addEventListener('change',async event=>{
    if(replayed.has(event)){replayed.delete(event);return;}
    const select=event.target;
    if(!isPatientControl(select))return;
    event.preventDefault();event.stopImmediatePropagation();event.stopPropagation();
    const old=active.get(select.id),id=currentPatientId(select);
    if(!id){
      active.delete(select.id);
      await releaseIfUnused(old?.patientId,moduleFor(select.id),select.id);
      const next=new Event('change',{bubbles:true});replayed.add(next);select.dispatchEvent(next);return;
    }
    try{
      const module=moduleFor(select.id,select);
      await api('',{method:'POST',body:JSON.stringify({patient_id:id,module})});
      active.set(select.id,{patientId:id,module,optionValue:select.value,renewedAt:Date.now()});
      if(old?.patientId&&old.patientId!==id)await releaseIfUnused(old.patientId,old.module,select.id);
      const next=new Event('change',{bubbles:true});replayed.add(next);select.dispatchEvent(next);
    }catch(error){
      select.value=old?.optionValue||'';
      alert(error.message);
      refreshOptions(select);
    }
  },true);
  window.setInterval(async()=>{
    for(const [controlId,selection] of active){
      if(selection.persistent){
        if(Date.now()-selection.renewedAt<60000)continue;
        try{await api('',{method:'POST',body:JSON.stringify({patient_id:selection.patientId,module:selection.module||moduleFor(controlId)})});selection.renewedAt=Date.now();}
        catch(error){active.delete(controlId);alert(error.message);}
        continue;
      }
      const select=document.getElementById(controlId);
      if(!select||currentPatientId(select)!==selection.patientId){active.delete(controlId);await releaseIfUnused(selection.patientId,selection.module,controlId);continue;}
      if(Date.now()-selection.renewedAt<60000)continue;
      try{await api('',{method:'POST',body:JSON.stringify({patient_id:selection.patientId,module:moduleFor(controlId,select)})});selection.renewedAt=Date.now();}
      catch(error){select.value='';active.delete(controlId);alert(error.message);}
    }
  },5000);
})();

// Add a Patient Files subtab to each role workspace that has role-scoped
// current-visit access. Doctor and Hospital Manager already have full-history
// Patient Files subtabs in their workspaces.
(function initRolePatientFileTabs() {
  const modules = {
    reception: {receptionist:'reception', opd:'opd'},
    nurse: {nurse:'nurse'},
    lab: {labtech:'lab'},
    pharmacy: {pharmacist:'pharmacy'},
    radiology: {radiologist:'radiology'},
    theatre: {surgeon:'theatre'},
    opd: {accountant:'finance', finance:'finance', finance_officer:'finance', accounts:'finance', accounts_officer:'finance'},
    'guidance-counseling': {guidance_counselor:'guidance-counseling', counselor:'guidance-counseling'}
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function json(url) {
    const response = await fetch(url, {credentials:'same-origin', cache:'no-store', headers:{Accept:'application/json'}});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load patient files.');
    return data;
  }
  function recordsMarkup(events) {
    return events.length ? events.map(event => '<article class="hms-patient-document-card"><div class="hms-patient-document-heading"><strong>'+esc(event.category||'Saved record')+'</strong><time>'+esc(event.date?new Date(event.date).toLocaleString():'Date not recorded')+'</time></div><dl class="hms-journey-fields">'+Object.entries(event.details||{}).map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl></article>').join('') : '<p class="hms-muted">No records for your role were found in this patient’s current visit.</p>';
  }
  async function install() {
    const response = await fetch('/api/auth/me', {credentials:'same-origin', cache:'no-store'});
    const auth = await response.json().catch(()=>({}));
    if (!response.ok || !auth.success) return;
    const role = String(auth.user?.role || '').toLowerCase();
    const moduleId = Object.keys(modules).find(id => modules[id][role]);
    if (!moduleId) return;
    const scope = modules[moduleId][role];
    const root = document.getElementById('mod-'+moduleId);
    if (!root || root.querySelector(':scope > .hms-role-patient-files-tabs')) return;

    const group = document.createElement('div');
    group.className = 'hms-tab-group hms-role-patient-files-tabs';
    const tabList = document.createElement('div');
    tabList.className = 'sub-tabs';
    tabList.setAttribute('role','tablist');
    tabList.setAttribute('aria-label','Workspace and patient files');
    const workspaceButton = document.createElement('button');
    workspaceButton.type='button'; workspaceButton.className='tab-btn active';
    workspaceButton.setAttribute('role','tab'); workspaceButton.setAttribute('aria-selected','true'); workspaceButton.textContent='Workspace';
    const filesButton = document.createElement('button');
    filesButton.type='button'; filesButton.className='tab-btn';
    filesButton.setAttribute('role','tab'); filesButton.setAttribute('aria-selected','false'); filesButton.textContent='Patient Files';
    const workspace = document.createElement('section');
    workspace.className='tab-content active'; workspace.id='role-workspace-'+moduleId;
    const files = document.createElement('section');
    files.className='tab-content'; files.id='role-patient-files-'+moduleId; files.hidden=true;
    files.innerHTML='<div class="card hms-admin-window"><div class="card-header">Patient Files · Current Visit</div><p class="hms-muted">Search a patient to view and print only '+esc(role.replaceAll('_',' '))+' records from the current visit.</p><label for="role-patient-search-'+moduleId+'">Find patient by ID or name</label><input id="role-patient-search-'+moduleId+'" type="search" autocomplete="off" placeholder="Start typing a patient ID or name…"><div class="hms-patient-match-list" data-role-patient-matches></div><div class="hms-patient-journey-title" data-role-patient-title>Select a patient to load this visit’s records.</div><div class="hms-journey-print-actions no-print"><button type="button" class="btn btn-secondary" data-role-patient-print disabled>Print current-visit records</button></div><div class="hms-patient-document-store" data-role-patient-records aria-live="polite"><p class="hms-muted">No patient selected.</p></div></div>';
    tabList.append(workspaceButton,filesButton);
    group.append(tabList,workspace,files);
    while(root.firstChild) workspace.appendChild(root.firstChild);
    root.appendChild(group);
    workspaceButton.addEventListener('click',()=>switchHmsNestedTab(workspaceButton,workspace.id));
    filesButton.addEventListener('click',()=>switchHmsNestedTab(filesButton,files.id));

    const input=files.querySelector('input[type="search"]'), matches=files.querySelector('[data-role-patient-matches]');
    const title=files.querySelector('[data-role-patient-title]'), records=files.querySelector('[data-role-patient-records]');
    const printButton=files.querySelector('[data-role-patient-print]');
    let timer=null, selected=null;
    input.addEventListener('input',()=>{
      clearTimeout(timer); selected=null; printButton.disabled=true; records.innerHTML='<p class="hms-muted">Select a patient to load this visit’s records.</p>';
      const query=input.value.trim(); if(!query){matches.innerHTML='';return;}
      timer=setTimeout(async()=>{
        matches.innerHTML='<p class="hms-muted">Searching…</p>';
        try {
          const data=await json('/api/admin/hospital/patients?q='+encodeURIComponent(query));
          const patients=data.patients||[];
          matches.innerHTML=patients.length?patients.map(patient=>'<button type="button" class="hms-patient-match" data-patient-id="'+Number(patient.id)+'"><strong>'+esc(patient.full_name)+'</strong><span>'+esc(patient.patient_id)+'</span></button>').join(''):'<p class="hms-muted">No matching active patient found.</p>';
        } catch(error) { matches.innerHTML='<p class="hms-error">'+esc(error.message)+'</p>'; }
      },250);
    });
    matches.addEventListener('click',async event=>{
      const button=event.target.closest('[data-patient-id]'); if(!button)return;
      selected=null; printButton.disabled=true; title.textContent='Loading current visit…'; records.innerHTML='<p class="hms-muted">Loading role-specific records…</p>';
      try {
        const data=await json('/api/admin/hospital/patient-journey/'+encodeURIComponent(button.dataset.patientId)+'?scope='+encodeURIComponent(scope));
        selected=data; title.textContent=(data.patient?.full_name||'Patient')+' · '+(data.patient?.patient_id||'')+' · Visit '+(data.current_visit?.reference||'');
        records.innerHTML=recordsMarkup(data.journey||[]); printButton.disabled=false;
      } catch(error) { title.textContent='Unable to load current visit'; records.innerHTML='<p class="hms-error">'+esc(error.message)+'</p>'; }
    });
    printButton.addEventListener('click',()=>{
      if(!selected)return;
      const popup=window.open('','_blank','width=950,height=750'); if(!popup){alert('Allow pop-ups to print the patient record.');return;}
      const patient=selected.patient||{}, visit=selected.current_visit||{};
      popup.document.open(); popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Current visit records</title><style>body{font:14px Arial,sans-serif;color:#172033;margin:30px}header{border-bottom:2px solid #0f5968;padding-bottom:14px}article{border:1px solid #cbd5e1;border-radius:7px;padding:13px;margin:12px 0;break-inside:avoid}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 16px}dl div{border-bottom:1px solid #e2e8f0;padding:5px 0}dt{font-size:11px;color:#64748b}dd{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:15mm}}</style></head><body><header><h1>'+esc(role.replaceAll('_',' '))+' · Current Visit Records</h1><h2>'+esc(patient.full_name||'Patient')+' · '+esc(patient.patient_id||'')+'</h2><p>Visit: '+esc(visit.reference||'—')+' · Department: '+esc(visit.department||'—')+' · Date: '+esc(visit.date?new Date(visit.date).toLocaleDateString():'—')+'</p></header>'+recordsMarkup(selected.journey||[])+'</body></html>'); popup.document.close(); setTimeout(()=>{popup.focus();popup.print();},120);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();

// Unified forwarding items: one card contains its title, message and every attachment.
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={hospital_administration:'Hospital Administration',accounts:'Finance',procurement:'Procurement'};
  async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options});const data=await response.json().catch(()=>({}));if(!response.ok||!data.success)throw new Error(data.error||'Forwarding request failed.');return data;}
  function forwardTypes(row){return [...new Set((row.attachments||[]).map(file=>file.title||row.title||'Forwarded document'))];}
  function applyHistoryFilters(history){const from=history.querySelector('[data-forward-from]')?.value||'',to=history.querySelector('[data-forward-to]')?.value||'',search=(history.querySelector('[data-forward-search]')?.value||'').trim().toLowerCase();history.querySelectorAll('[data-forward-history-item]').forEach(item=>{const date=(item.dataset.forwardedAt||'').slice(0,10),haystack=(item.dataset.forwardedSearch||'').toLowerCase();item.hidden=!!((from&&date<from)||(to&&date>to)||(search&&!haystack.includes(search)));});}
  async function render(panel){const history=panel.querySelector('[data-chat-history]');if(!history)return;try{const data=await api('/api/department-communication/forwards');const rows=data.forwards||[];const filters=rows.length?'<div class="department-chat-history-filters"><label>From date<input type="date" data-forward-from></label><label>To date<input type="date" data-forward-to></label><label>Search name or document<input type="search" data-forward-search placeholder="Sender, recipient or document"></label></div>':'';history.innerHTML=rows.length?filters+rows.map(row=>{const searchText=[row.sender_name,row.sender_department,row.recipient_department,row.title,...(row.attachments||[]).flatMap(file=>[file.title,file.original_filename])].join(' ');return '<article class="department-chat-item" data-forward-history-item data-forwarded-at="'+esc(row.created_at)+'" data-forwarded-search="'+esc(searchText)+'"><div class="department-chat-item-head"><strong>'+esc(labels[row.sender_department]||row.sender_department)+' → '+esc(labels[row.recipient_department]||row.recipient_department)+'</strong><small>'+esc(row.sender_name)+' · '+esc(new Date(row.created_at).toLocaleString())+'</small></div><p><strong>'+esc(row.title||'Forwarded item')+'</strong>'+(row.message?'<br>'+esc(row.message):'')+'</p><p>'+(row.attachments||[]).map((file,index)=>'📎 '+esc(file.title||'Document')+' · Attachment '+(index+1)+': '+esc(file.original_filename)).join('<br>')+'</p><div class="department-chat-item-actions"><a class="btn btn-secondary btn-small" target="_blank" rel="noopener" href="'+esc(row.view_url)+'">View PDF</a><a class="btn btn-secondary btn-small" href="'+esc(row.download_url)+'">Download PDF</a><button type="button" class="btn btn-primary btn-small" data-forward-again="'+esc(row.id)+'" data-forward-title="'+esc(row.title||'Forwarded document')+'">Forward again</button></div></article>';}).join(''):'<p>No forwarding items yet.</p>';history.querySelectorAll('[data-forward-from],[data-forward-to]').forEach(control=>control.addEventListener('change',()=>applyHistoryFilters(history)));history.querySelector('[data-forward-search]')?.addEventListener('input',()=>applyHistoryFilters(history));}catch(error){history.innerHTML='<p class="hms-error">'+esc(error.message)+'</p>';}}
  let reforwardDialog;
  function openReForwardDialog(button){const panel=button.closest('[data-department-chat]');if(!panel||!reforwardDialog)return;reforwardDialog._panel=panel;reforwardDialog.querySelector('[name="forward_id"]').value=button.dataset.forwardAgain;reforwardDialog.querySelector('[name="title"]').value=button.dataset.forwardTitle||'Forwarded document';reforwardDialog.querySelector('[name="recipient_department"]').value='';reforwardDialog.hidden=false;reforwardDialog.querySelector('[name="recipient_department"]').focus();}
  document.addEventListener('DOMContentLoaded',()=>{reforwardDialog=document.createElement('div');reforwardDialog.className='department-chat-store-dialog';reforwardDialog.hidden=true;reforwardDialog.innerHTML='<div class="department-chat-store-dialog-card department-chat-reforward-card" role="dialog" aria-modal="true" aria-labelledby="reforward-title"><div class="card-header" id="reforward-title">Forward document again</div><p>This forwards every attachment from the original item together and adds one signed-by stamp with the sender name, role and date. Earlier stamps remain on separate lines.</p><form data-reforward-form><input type="hidden" name="forward_id"><input type="hidden" name="title"><label>Send to<select name="recipient_department" required><option value="">Choose department</option><option value="hospital_administration">Hospital Administration</option><option value="accounts">Finance</option><option value="procurement">Procurement</option></select></label><div class="department-chat-actions"><button type="submit" class="btn btn-primary">Forward</button><button type="button" class="btn btn-secondary" data-reforward-close>Cancel</button></div><div data-reforward-status role="status"></div></form></div>';document.body.appendChild(reforwardDialog);reforwardDialog.querySelector('[data-reforward-close]').addEventListener('click',()=>reforwardDialog.hidden=true);reforwardDialog.addEventListener('click',event=>{if(event.target===reforwardDialog)reforwardDialog.hidden=true;});reforwardDialog.querySelector('[data-reforward-form]').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),status=form.querySelector('[data-reforward-status]');if(!form.reportValidity())return;button.disabled=true;try{const data=new FormData();data.set('recipient_department',form.elements.recipient_department.value);data.set('forwarded_forward_id',form.elements.forward_id.value);data.set('title',form.elements.title.value);data.set('stamp_attachment','yes');await api('/api/department-communication/forward',{method:'POST',body:data});reforwardDialog.hidden=true;await render(reforwardDialog._panel);}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});setTimeout(()=>document.querySelectorAll('[data-department-chat]').forEach(panel=>{const form=panel.querySelector('[data-chat-send-form]');if(form&&!form.querySelector('[name="forwarded_forward_id"]')){const input=document.createElement('input');input.type='hidden';input.name='forwarded_forward_id';form.appendChild(input);}render(panel);}),150);});
  document.addEventListener('submit',async event=>{const form=event.target.closest?.('[data-chat-send-form]');if(!form)return;event.preventDefault();event.stopImmediatePropagation();const panel=form.closest('[data-department-chat]'),status=panel?.querySelector('[data-chat-status]'),button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;try{const result=await api('/api/department-communication/forward',{method:'POST',body:new FormData(form)});form.reset();form.querySelector('[data-chat-secretariate-preview]')?.remove();if(panel)panel.querySelector('[data-chat-selected-store-file]').textContent='No document selected from the store.';if(status)status.textContent=result.warning||'Forwarded successfully.';await render(panel);}catch(error){if(status)status.textContent=error.message;}finally{if(button)button.disabled=false;}},true);
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-chat-refresh]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();render(button.closest('[data-department-chat]'));},true);
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-forward-again]');if(!button)return;event.preventDefault();openReForwardDialog(button);},true);
})();

// Give every departmental Forwarding panel a dedicated history subtab without
// duplicating the compose form or its existing event handlers.
(function(){
  function installForwardingSubtabs(){
    document.querySelectorAll('[data-department-chat]').forEach(panel=>{
      if(panel.dataset.forwardingSubtabsReady==='yes')return;
      const form=panel.querySelector('[data-chat-send-form]'),history=panel.querySelector('[data-chat-history]');
      if(!form||!history)return;
      panel.dataset.forwardingSubtabsReady='yes';
      const intro=panel.querySelector('.hms-office-intro'),status=panel.querySelector('[data-chat-status]'),heading=[...panel.querySelectorAll('h4')].find(item=>item.textContent.trim()==='Conversation history');
      const tabs=document.createElement('div');tabs.className='sub-tabs department-chat-subtabs';tabs.setAttribute('role','tablist');tabs.innerHTML='<button type="button" class="tab-btn active" role="tab" aria-selected="true">Forward document</button><button type="button" class="tab-btn" role="tab" aria-selected="false">Forwarding history</button>';
      const compose=document.createElement('section');compose.className='department-chat-subtab-content active';
      const historyPane=document.createElement('section');historyPane.className='department-chat-subtab-content';historyPane.hidden=true;
      panel.querySelector('.card-header')?.insertAdjacentElement('afterend',tabs);
      [intro,form,status].filter(Boolean).forEach(item=>compose.appendChild(item));
      [heading,history].filter(Boolean).forEach(item=>historyPane.appendChild(item));
      tabs.insertAdjacentElement('afterend',compose);compose.insertAdjacentElement('afterend',historyPane);
      const buttons=[...tabs.querySelectorAll('.tab-btn')];
      buttons.forEach((button,index)=>button.addEventListener('click',()=>{const showHistory=index===1;buttons.forEach((item,itemIndex)=>{const active=itemIndex===index;item.classList.toggle('active',active);item.setAttribute('aria-selected',active?'true':'false');});compose.hidden=showHistory;compose.classList.toggle('active',!showHistory);historyPane.hidden=!showHistory;historyPane.classList.toggle('active',showHistory);}));
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installForwardingSubtabs);else installForwardingSubtabs();
})();

// Finance dispensing voucher template and forwarding attachment selection.
(function(){
  async function request(url, options={}) {
    const response=await fetch(url,{credentials:'same-origin',headers:{'Accept':'application/json',...(options.headers||{})},...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.success) throw new Error(data.error||'Request failed.');
    return data;
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    await hmsWaitForAuthRole();
    if(!hmsRoleMayCall('/api/department-communication/accounts-dispensing'))return;
    const form=document.getElementById('accounts-dispensing-template-form');
    if(form){
      form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;const status=document.getElementById('accounts-dispensing-template-status'),button=form.querySelector('button[type="submit"]');button.disabled=true;if(status)status.textContent='Saving voucher to the Funds Dispensing Document Store...';try{const voucher=(await request('/api/department-communication/accounts-dispensing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))})).document;form.reset();if(status)status.textContent='Saved '+voucher.reference+' to Funds Dispensing Documents. Open that tab to review, print or forward it.';await window.refreshHmsFundDispensingRecords?.();}catch(error){if(status)status.textContent=error.message;}finally{button.disabled=false;}});
    }
    const panel=document.getElementById('accounts-forwarding');
    const file=panel?.querySelector('input[name="file"]');
    file?.addEventListener('change',()=>{if(file.files?.length){const field=panel.querySelector('input[name="accounts_dispensing_document_id"]');if(field)field.value='';}});
  });
})();


// =========================================================
// GLOBAL HMS LOGGED-IN USER READER
// DO NOT CALL window.getLoggedInUser() FROM INSIDE IT
// =========================================================

window.getLoggedInUser = getLoggedInUser;
    // =========================================================
    // LOGOUT
    // =========================================================

    window.logoutHMS = async function () {

    try {

        await fetch(
            '/api/auth/logout',
            {
                method: 'POST',
                credentials: 'same-origin'
            }
        );

    } catch (error) {

        console.error(
            'HMS logout failed:',
            error
        );

    } finally {

        window.location.replace('/login');

    }
};

// =========================================================
// MASTER SYSTEM STATE
// =========================================================

const state = {

  modules: [

    {
      id: 'dash',
      name: 'Hospital Administration',
      icon: '📊'
    },

    {
      id: 'admin',
      name: 'System Management',
      icon: '⚙️'
    },

    {
      id: 'reception',
      name: 'OPD',
      icon: '📋'
    },

    {
      id: 'doctor',
      name: 'Doctor Consultation',
      icon: '👨‍⚕️'
    },

    {
      id: 'lab',
      name: 'Laboratory',
      icon: '🔬'
    },

    {
      id: 'pharmacy',
      name: 'Pharmacy Dispensing',
      icon: '💊'
    },

    {
      id: 'radiology',
      name: 'Radiology Dept',
      icon: '🩻'
    },

    {
      id: 'nurse',
      name: 'Inpatient Nurse',
      icon: '💉'
    },

    {
      id: 'theatre',
      name: 'Operating Theatre',
      icon: '🔪'
    },

    {
      id: 'opd',
      name: 'Finance',
      icon: '💳'
    },

    // =====================================================
    // PROCUREMENT
    // HTML MODULE: mod-procurement
    // =====================================================
    {
      id: 'procurement',
      name: 'Procurement',
      icon: '📦'
    },

    {
      id: 'guidance-counseling',
      name: 'Guidance & Counseling',
      icon: '🧭'
    },
  ],


  config: {

    departments: [],
    wards: [],
    services: []

  },

  inventory: [],

  staff: [],

  users: [],

  patients: [],

  auditLogs: [],

  revenue: 0,

  generatedReports: [],

  settings: {

    currency: '$',

    hospitalName:
      'Hospital Management System',

    autoSave:
      true

  }

};

// =========================================================
// HMS STARTUP
// Initialize HMS after the HTML exists.
// Explicitly load the database dashboard after initial UI
// initialization to prevent the dashboard remaining at zero.
// =========================================================

async function initializeHMS() {

    const navContainer =
        document.getElementById('nav-container');

    // Do not initialize HMS navigation on login pages.
    if (!navContainer) {
        return;
    }

    console.log('HMS INITIALIZATION STARTED');

    console.log(
        'nav-container:',
        navContainer
    );

    console.log(
        'modules:',
        state.modules
    );

    console.log(
        'modules count:',
        state.modules?.length
    );

    // Render navigation and open the first authorized module.
    await renderNav();

    // Record system initialization when the optional audit helper exists.
    // A missing audit helper must never abort HMS startup or leave the page blank.
    if (typeof logAudit === 'function') {
        try {
            logAudit('System initialization complete.');
        } catch (auditError) {
            console.warn('HMS: startup audit logging failed:', auditError);
        }
    } else {
        console.warn('HMS: logAudit() is not available; continuing startup.');
    }

    // Refresh the existing HMS interface.
    if (typeof refreshUI === 'function') {
        refreshUI();
    }

    // -------------------------------------------------------
    // LOAD ADMIN PATIENTS ONLY FOR ADMIN USERS
    // -------------------------------------------------------

    const currentUser =
        typeof getLoggedInUser === 'function'
            ? getLoggedInUser()
            : null;

    if (
        currentUser &&
        ['system_admin'].includes(
            String(currentUser.role || '').toLowerCase()
        ) &&
        document.getElementById('admin-pt-select') &&
        typeof loadAdminPatients === 'function'
    ) {
        loadAdminPatients();
    }

    // -------------------------------------------------------
    // FINAL DATABASE DASHBOARD LOAD
    // Run after initial UI initialization.
    // -------------------------------------------------------

    const dashboard =
        document.getElementById('mod-dash');

    if (
        currentUser &&
        ['system_admin', 'hospital_manager'].includes(
            String(currentUser.role || '').toLowerCase()
        ) &&
        dashboard &&
        dashboard.classList.contains('active') &&
        typeof window.loadDashboardFromDatabase === 'function'
    ) {

        try {

            await window.loadDashboardFromDatabase();

        } catch (error) {

            console.error(
                'HMS INITIAL DASHBOARD LOAD ERROR:',
                error
            );

        }

    }

    console.log(
        'HMS INITIALIZATION COMPLETE'
    );

}

// ---------------------------------------------------------
// WAIT UNTIL THE HTML EXISTS
// ---------------------------------------------------------

if (document.readyState === 'loading') {

    document.addEventListener(
        'DOMContentLoaded',
        initializeHMS,
        { once: true }
    );

} else {

    initializeHMS();

}

console.log("=================================");
console.log("HMS NAV TEST");
console.log("Current URL:", window.location.href);
console.log("Document ready state:", document.readyState);
console.log(
    "nav-container:",
    document.getElementById("nav-container")
);
console.log(
    "modules:",
    state.modules
);
console.log(
    "modules count:",
    state.modules?.length
);
console.log("=================================");

// =========================================================
// SAFE HTML
// =========================================================

function escapeHTML(value) {

  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

}

// =========================================================
// MONEY
// =========================================================

function money(value) {

  const amount =
    Number(value) || 0;

  return `${state.settings.currency}${amount.toFixed(2)}`;

}


// =========================================================
// LOAD AUDIT LOGS FROM DATABASE
// =========================================================

async function loadAuditLogs() {

    const consoleEl =
        document.getElementById(
            'audit-log-console'
        );

    if (!consoleEl) {
        return;
    }

    consoleEl.innerHTML = `
        <div style="color:#94a3b8;">
            Loading audit logs...
        </div>
    `;

    try {

        const response =
            await fetch(
                '/api/security/audit-logs',
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store'
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to load audit logs.'
            );

        }

        const logs =
            Array.isArray(data.logs)
                ? data.logs
                : [];

        if (logs.length === 0) {

            consoleEl.innerHTML = `
                <div style="color:#94a3b8;">
                    No audit logs found.
                </div>
            `;

            return;
        }

        consoleEl.innerHTML =
            logs.map(log => {

                const timestamp =
                    log.created_at
                    ? new Date(
                        log.created_at
                      ).toLocaleString()
                    : '';

                const username =
                    log.username ||
                    'Unknown User';

                const role =
                    log.role ||
                    'Unknown Role';

                const action =
                    log.action ||
                    '';

                const module =
                    log.module ||
                    '';

                const description =
                    log.description ||
                    '';

                return `
                    <div
                        style="
                            margin-bottom:8px;
                            padding-bottom:6px;
                            border-bottom:1px solid #334155;
                        "
                    >
                        <div>
                            <strong>
                                ${escapeHTML(timestamp)}
                            </strong>
                        </div>

                        <div>
                            <strong>
                                ${escapeHTML(username)}
                            </strong>

                            <span>
                                (${escapeHTML(role)})
                            </span>
                        </div>

                        <div>
                            ${escapeHTML(action)}
                            ${module
                                ? ` — ${escapeHTML(module)}`
                                : ''
                            }
                        </div>

                        <div>
                            ${escapeHTML(description)}
                        </div>
                    </div>
                `;

            }).join('');

    } catch (error) {

        console.error(
            'AUDIT LOG LOAD ERROR:',
            error
        );

        consoleEl.innerHTML = `
            <div style="color:#f87171;">
                Unable to load audit logs.
            </div>
        `;

    }

}
// =========================================================
// MODULE SWITCHING WITH ROLE PROTECTION
// =========================================================

// =========================================================
// SWITCH HMS MODULE
// ROLE-PROTECTED NAVIGATION
// =========================================================

// =========================================================
// HOME LAUNCHER (replaces the old sidebar)
// =========================================================

function hmsSetInModule(inModule) {
  document.body.classList.toggle('hms-in-module', !!inModule);

  const brandLabel = document.querySelector('#hms-main-header .hms-active-label');
  if (brandLabel && document.body.dataset.pageMode === 'opd') {
    brandLabel.textContent = 'OPD Portal';
  }

  const homeBtn = document.getElementById('hms-home-btn');
  if (homeBtn) {
    const authorized = document.querySelectorAll('#nav-container .nav-btn.nav-authorized').length;
    homeBtn.hidden = !inModule || authorized <= 1;
  }
}

function hmsFillHomeHero(user, moduleCount) {
  const roleLabels = {
    admin: 'System Admin', system_admin: 'System Admin', hospital_manager: 'Hospital Manager',
    doctor: 'Doctor', nurse: 'Nurse', labtech: 'Lab Tech', pharmacist: 'Pharmacist',
    radiologist: 'Radiologist', surgeon: 'Surgeon', opd: 'OPD', receptionist: 'Receptionist',
    accountant: 'Finance Officer', secretary: 'Secretary', procurement_officer: 'Procurement Officer',
    guidance_counselor: 'Counselor', counselor: 'Counselor'
  };
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (user && (user.username || user.name)) || '';
  const title = document.getElementById('hms-hero-title');
  const meta = document.getElementById('hms-hero-meta');
  if (title) title.textContent = name ? `${greeting}, ${name}` : greeting;
  if (meta) {
    const chips = [
      roleLabels[user && user.role] || (user && user.role) || '',
      `${moduleCount} module${moduleCount === 1 ? '' : 's'} available`,
      new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    ].filter(Boolean);
    meta.innerHTML = chips.map(text => `<span class="hero-chip">${escapeHTML(text)}</span>`).join('');
  }
}

function showHmsHome() {
  document.querySelectorAll('.module-view').forEach(element => {
    element.classList.remove('active');
  });

  document.querySelectorAll('.nav-btn').forEach(element => {
    element.classList.remove('active');
  });

  hmsSetInModule(false);

  const title = document.getElementById('current-module-title');
  if (title) {
    title.textContent = 'Home';
  }

  if (typeof state !== 'undefined') {
    state.activeModule = null;
  }

  window.scrollTo(0, 0);
}

window.showHmsHome = showHmsHome;

function switchModule(
  id,
  name = '',
  button = null
) {
  const user = getLoggedInUser();

  if (!user) {
    console.warn('HMS: No logged-in user.');
    window.location.replace('/login');
    return;
  }

  // Compatibility aliases: triage now lives inside OPD/Reception.
  if (id === 'triage') {
    id = 'reception';
    name = 'OPD';
  }

  if (!hasModuleAccess(id)) {
    console.warn(
      `HMS: Access denied. Role "${user.role}" cannot open "${id}".`
    );
    alert('You are not authorized to access this HMS module.');
    return;
  }

  if (typeof state !== 'undefined') {
    state.currentUser = user;
  }

  document.querySelectorAll('.module-view').forEach(element => {
    element.classList.remove('active');
  });

  document.querySelectorAll('.nav-btn').forEach(element => {
    element.classList.remove('active');
  });

  const target = document.getElementById(`mod-${id}`);

  if (!target) {
    console.error(`HMS: Module view not found: mod-${id}`);
    return;
  }

  if (id === 'doctor') {
    const rounds = document.getElementById('doc-nursing-rounds');
    const roundsToggle = document.getElementById('doc-nursing-rounds-toggle');
    const consultation = document.getElementById('doc-consultation-workspace');
    if (rounds) {
      rounds.hidden = true;
      rounds.style.removeProperty('display');
      rounds.classList.remove('active');
    }
    if (consultation) consultation.hidden = false;
    if (roundsToggle) {
      roundsToggle.hidden = false;
      roundsToggle.textContent = 'Doctor’s Rounds';
      roundsToggle.setAttribute('aria-expanded', 'false');
    }
  }

  target.classList.add('active');
  target.hidden = false;
  target.style.display = '';
  hmsSetInModule(true);

  if (button) {
    button.classList.add('active');
  } else {
    const navButton = document.querySelector(
      `.nav-btn[data-module="${id}"]`
    );
    navButton?.classList.add('active');
  }

  const moduleDefinition = state.modules.find(module => module.id === id);
  const moduleTitle = name || moduleDefinition?.name || id;
  const title = document.getElementById('current-module-title');

  if (title) {
    title.textContent = moduleTitle;
  }

  state.activeModule = id;
  sessionStorage.setItem('hms-active-module', id);

  // Guidance & Counseling has its own nested workspace. Explicitly restore
  // its overview panel whenever the module is opened so a stale hidden tab
  // cannot leave the entire page looking blank.
  if (id === 'guidance-counseling') {
    const overview = document.getElementById('gc-overview');
    const overviewButton = document.querySelector('#guidance-counseling-tabs .tab-btn[onclick*="gc-overview"]');
    if (overview && overviewButton) switchHmsNestedTab(overviewButton, 'gc-overview');
    if (typeof window.refreshGuidanceCounseling === 'function') {
      window.refreshGuidanceCounseling();
    }
  }

  // The Finance module uses mod-opd in the existing HTML.
  // Rename only this module's visible labels; keep genuine OPD workflow
  // labels and API routes elsewhere unchanged.
  if (id === 'opd') {
    const accountsHeader = target.querySelector('.card-header');
    if (accountsHeader) {
      accountsHeader.textContent = 'Finance & Billing';
    }

    const emptyHeading = target.querySelector('#opd-empty-state h3');
    if (emptyHeading) {
      emptyHeading.textContent = 'Finance Patient Records';
    }

    const emptyParagraph = target.querySelector('#opd-empty-state p');
    if (emptyParagraph) {
      emptyParagraph.textContent =
        'Select a patient above to view patient account and billing records.';
    }

    if (typeof loadOPDPatients === 'function') {
      Promise.resolve(loadOPDPatients()).catch(error => {
        console.error('ACCOUNTS PATIENT LOAD ERROR:', error);
      });
    }
  }

  // OPD is the Reception module. Triage remains in its nested tab.
  if (id === 'reception') {
    if (typeof populateReceptionDepartmentSelect === 'function') {
      populateReceptionDepartmentSelect();
    }

    if (typeof initializeTriageModule === 'function') {
      Promise.resolve(initializeTriageModule()).catch(error => {
        console.error('RECEPTION TRIAGE INITIALIZATION ERROR:', error);
      });
    } else {
      if (typeof loadTriageDepartments === 'function') loadTriageDepartments();
      if (typeof loadTriagePatientQueue === 'function') loadTriagePatientQueue();
    }
  }

  if (id === 'doctor') {
    if (typeof setupDoctorMedicationSearch === 'function') {
      setupDoctorMedicationSearch();
    }

    if (typeof loadInventoryFromDatabase === 'function') {
      loadInventoryFromDatabase().catch(error => {
        console.error('DOCTOR INVENTORY LOAD ERROR:', error);
      });
    }

    if (typeof loadDoctorClinicPatients === 'function') {
      loadDoctorClinicPatients().catch(error => {
        console.error('DOCTOR QUEUE INITIALIZATION ERROR:', error);
      });
    }

    if (typeof loadDoctorNursingReviewReports === 'function') {
      loadDoctorNursingReviewReports().catch(error => {
        console.error('DOCTOR NURSING REPORT INITIALIZATION ERROR:', error);
      });
    }
  }

  if (id === 'theatre' && typeof loadTheatrePatients === 'function') {
    loadTheatrePatients();
  }

  if (id === 'nurse') {
    target.style.display = 'block';
    target.hidden = false;

    const nursingContentArea = target.closest('.content-area');
    if (nursingContentArea) {
      nursingContentArea.style.display = 'block';
      nursingContentArea.hidden = false;
    }

    if (typeof loadNursePatients === 'function') {
      loadNursePatients().catch(error => {
        console.error('NURSING MODULE LOAD ERROR:', error);
        target.classList.add('active');
        target.style.display = 'block';
        target.hidden = false;
      });
    }

    if (typeof loadInpatientWardCare === 'function') {
      loadInpatientWardCare().catch(error => {
        console.error('INPATIENT WARD LOAD ERROR:', error);
      });
    }

    if (typeof loadNurseBeds === 'function') {
      loadNurseBeds().catch(error => {
        console.error('NURSE BED LOAD ERROR:', error);
      });
    }
  }

  if (id === 'radiology' && typeof loadRadiologyQueue === 'function') {
    loadRadiologyQueue();
  }

  if (id === 'lab' && typeof loadLabOrders === 'function') {
    loadLabOrders();
  }

  if (id === 'pharmacy' && typeof initializePharmacyModule === 'function') {
    initializePharmacyModule();
  }

  if (id === 'dash' && typeof window.loadDashboardFromDatabase === 'function') {
    Promise.resolve(window.loadDashboardFromDatabase()).catch(error => {
      console.error('HMS DASHBOARD LOAD ERROR:', error);
    });

    if (hmsDashboardRefreshTimer) {
      clearInterval(hmsDashboardRefreshTimer);
    }

    hmsDashboardRefreshTimer = setInterval(() => {
      const dashboard = document.getElementById('mod-dash');
      if (dashboard && dashboard.classList.contains('active')) {
        Promise.resolve(window.loadDashboardFromDatabase()).catch(error => {
          console.error('HMS DASHBOARD REFRESH ERROR:', error);
        });
      }
    }, 30000);
  }

  if (typeof refreshUI === 'function' &&
      !['radiology', 'pharmacy', 'nurse'].includes(id)) {
    refreshUI();
  }
}

// =========================================================
// NESTED HMS TABS
// Used by OPD/Reception and the Doctor patient-record panels.
// =========================================================

function switchHmsNestedTab(button, tabId) {
  const targetTab = document.getElementById(tabId);
  if (!targetTab) {
    console.error('HMS nested tab content not found:', tabId);
    return;
  }

  // Prefer the panel's owning group. A few legacy Doctor panels (notably
  // Follow-up & Referral) sit just outside the tab-group wrapper, so fall
  // back to the clicked button's group for those panels.
  const group = targetTab.closest('.hms-tab-group') || (button && button.closest('.hms-tab-group'));
  if (!group) {
    console.error('HMS tab panel has no owning tab group:', tabId);
    return;
  }

  // Toggle panels owned by this group, plus the selected legacy panel when
  // it is outside the wrapper. This keeps Doctor Follow-up & Referral usable
  // without affecting unrelated tabs elsewhere on the page.
  const panels = Array.from(group.querySelectorAll('.tab-content')).filter(panel => panel.closest('.hms-tab-group') === group);
  if (!panels.includes(targetTab)) panels.push(targetTab);
  panels.forEach(panel => {
    const active = panel === targetTab;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
    panel.style.display = active ? 'block' : 'none';
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  const tabList = group.querySelector('.sub-tabs');
  if (tabList) {
    Array.from(tabList.querySelectorAll(':scope > .tab-btn')).forEach(tabButton => {
      const isActive = tabButton === button || (!button && (tabButton.getAttribute('onclick') || '').includes(tabId));
      tabButton.classList.toggle('active', isActive);
      tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // Refresh data when these panels become visible, so a hidden-panel load or
  // stale summary cannot leave the Stock & Expiry panel looking empty.
  if (tabId === 'hospital-admin-stock-levels' && typeof refreshAdminOperationsSummary === 'function') {
    refreshAdminOperationsSummary();
  }
  if (tabId === 'reception-triage-assessment') {
    if (typeof loadTriageDepartments === 'function') loadTriageDepartments();
    if (typeof loadTriagePatientQueue === 'function') loadTriagePatientQueue();
  }
  if (tabId === 'doc-record-nursing') {
    if (typeof loadDoctorNursingReviewReports === 'function') loadDoctorNursingReviewReports();
    const patientId = document.getElementById('doc-patient-select')?.value;
    if (patientId && typeof loadDoctorNursingRecords === 'function') loadDoctorNursingRecords(patientId);
  }
  if (tabId === 'doc-record-progress') {
    const patientId = document.getElementById('doc-patient-select')?.value;
    if (patientId && typeof loadDoctorPatientDetailsForPanels === 'function') loadDoctorPatientDetailsForPanels(patientId);
  }
}

function toggleDoctorRecordTabs(patientId) {
  const tabs = document.getElementById('doc-patient-record-tabs');
  if (tabs) {
    tabs.style.display = patientId ? 'block' : 'none';
  }

  if (!patientId) {
    ['doc-vitals-summary', 'doc-laboratory-content',
     'doc-radiology-results', 'doc-clinical-progress-content',
     'doctor-nursing-care-history'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<em>Select a patient to view records.</em>';
      }
    });
  }
}

function openReceptionTriageAssessment() {
  const user = getLoggedInUser();
  if (!user) {
    window.location.replace('/login');
    return;
  }

  switchModule('reception', 'OPD');
  const tabButton = Array.from(
    document.querySelectorAll('#mod-reception .tab-btn')
  ).find(button => {
    const onclick = button.getAttribute('onclick') || '';
    return onclick.includes('reception-triage-assessment');
  });

  switchHmsNestedTab(tabButton, 'reception-triage-assessment');
}

// =========================================================
// SUB TAB SWITCHING
// =========================================================

function switchSubTab(
  button,
  tabId
) {

  // -------------------------------------------------------
  // HIDE ALL SUB-TAB CONTENT
  // -------------------------------------------------------

  document
    .querySelectorAll(
      '.tab-content'
    )
    .forEach(
      function (tab) {

        tab.classList.remove(
          'active'
        );

        tab.style.display =
          'none';

      }
    );

  // -------------------------------------------------------
  // REMOVE ACTIVE STATE FROM SUB-TAB BUTTONS
  // -------------------------------------------------------

  document
    .querySelectorAll(
      '.tab-btn'
    )
    .forEach(
      function (btn) {

        btn.classList.remove(
          'active'
        );

      }
    );

  // -------------------------------------------------------
  // SHOW SELECTED SUB-TAB
  // -------------------------------------------------------

  const selectedTab =
    document.getElementById(
      tabId
    );

  if (!selectedTab) {

    console.error(
      'Sub-tab content not found:',
      tabId
    );

    return;

  }

  selectedTab.classList.add(
    'active'
  );

  selectedTab.style.display =
    'block';

  // -------------------------------------------------------
  // ACTIVATE CLICKED BUTTON
  // -------------------------------------------------------

  if (
    button &&
    button.classList
  ) {

    button.classList.add(
      'active'
    );

  }

  // =======================================================
  // ADMIN: USERS
  // =======================================================

  if (
    tabId ===
    'admin-usr-mgt'
  ) {

    loadSystemUsers();

  }

  // =======================================================
  // ADMIN: STAFF
  // =======================================================

  if (
    tabId ===
    'admin-staff'
  ) {

    loadStaffFromDatabase();

    populateStaffDepartmentSelect();

  }

  // =======================================================
  // ADMIN: PATIENTS
  // =======================================================

  if (
    tabId ===
    'admin-pt-mgt'
  ) {

    loadAdminPatients();

  }

  // =======================================================
  // ADMIN: HOSPITAL SETUP
  // =======================================================

  if (
    tabId ===
    'admin-setup'
  ) {

    loadHospitalSetup();

  }

  // =======================================================
  // ADMIN: INVENTORY
  // =======================================================

  if (
    tabId ===
    'admin-inv'
  ) {

    initializeInventoryModule();

  }

  // =======================================================
  // ADMIN: SECURITY / AUDIT
  // =======================================================

  if (
    tabId ===
    'admin-sec'
  ) {

    loadAuditLogs();

  }

  // =======================================================
  // DOCTOR: FOLLOW-UP & REFERRAL
  //
  // IMPORTANT:
  // Reload nursing reports directly from PostgreSQL
  // whenever this tab is opened.
  // =======================================================

  if (
    tabId ===
    'doc-followup'
  ) {

    if (
      typeof loadDoctorNursingReviewReports ===
      'function'
    ) {

      loadDoctorNursingReviewReports();

    }

  }

}

// =========================================================
// OPEN DOCTOR CONSULTATION
// =========================================================

function openDoctorConsultation(button = null) {

  /*
   * We need to know which doctor is currently using HMS.
   *
   * This function will first look for the currently logged-in
   * user information.
   */

  const currentUser =
    state.currentUser ||
    state.loggedInUser ||
    state.user ||
    null;

  if (!currentUser) {

    alert(
      'Doctor identification is required before opening Doctor Consultation.'
    );

    return;
  }

  // =====================================================
  // FIND THE DOCTOR IN ADMINISTRATION STAFF REGISTRY
  // =====================================================

  const doctor =
    state.staff.find(staff => {

      const staffId =
        String(
          staff.id ||
          ''
        ).trim();

      const staffUsername =
        String(
          staff.username ||
          staff.user ||
          staff.name ||
          ''
        ).trim()
        .toLowerCase();

      const currentId =
        String(
          currentUser.id ||
          ''
        ).trim();

      const currentUsername =
        String(
          currentUser.username ||
          currentUser.user ||
          currentUser.name ||
          ''
        ).trim()
        .toLowerCase();

      return (
        (currentId && staffId === currentId) ||
        (
          currentUsername &&
          staffUsername === currentUsername
        )
      );

    });

  if (!doctor) {

    alert(
      'The currently logged-in doctor could not be found in the Administration Staff Registry.'
    );

    return;
  }

  // =====================================================
  // CHECK THAT THE USER IS ACTUALLY A DOCTOR
  // =====================================================

  const role =
    String(
      doctor.role ||
      doctor.position ||
      ''
    )
      .trim()
      .toLowerCase();

  if (
    !role.includes('doctor') &&
    !role.includes('physician')
  ) {

    alert(
      'Doctor Consultation is only available to registered doctors.'
    );

    return;
  }

  // =====================================================
  // GET DOCTOR'S REGISTERED CLINIC / DEPARTMENT
  // =====================================================

  const doctorClinic =
    String(
      doctor.dept ||
      doctor.department ||
      doctor.clinic ||
      ''
    ).trim();

  if (!doctorClinic) {

    alert(
      'This doctor has no clinic/department assigned in Administration.'
    );

    return;
  }

  // =====================================================
  // STORE CURRENT DOCTOR CONTEXT
  // =====================================================

  state.activeDoctor = {

    id:
      doctor.id || '',

    name:
      doctor.name ||
      doctor.username ||
      '',

    role:
      doctor.role ||
      doctor.position ||
      '',

    clinic:
      doctorClinic

  };

  // =====================================================
  // OPEN DOCTOR MODULE
  // =====================================================

  document
    .querySelectorAll('.module-view')
    .forEach(
      element =>
        element.classList.remove('active')
    );

  document
    .querySelectorAll('.nav-btn')
    .forEach(
      element =>
        element.classList.remove('active')
    );

  const target =
    document.getElementById(
      'mod-doctor'
    );

  if (target) {

    target.classList.add('active');
    hmsSetInModule(true);

  }

  if (button) {

    button.classList.add('active');

  }

  const title =
    document.getElementById(
      'current-module-title'
    );

  if (title) {

    title.innerText =
      `Doctor Consultation — ${doctorClinic}`;

  }

   // =====================================================
// INITIALIZE DOCTOR MEDICATION SEARCH
// =====================================================

if (
  typeof setupDoctorMedicationSearch === 'function'
) {

  setupDoctorMedicationSearch();

}

// =====================================================
// LOAD ONLY THIS DOCTOR'S CLINIC PATIENTS
// =====================================================

loadDoctorClinicPatients();

refreshUI();
}

// =========================================================
// BMI
// =========================================================

function calcBMI() {

  const weightEl =
    document.getElementById('v-weight');

  const heightEl =
    document.getElementById('v-height');

  const bmiEl =
    document.getElementById('v-bmi');

  if (
    !weightEl ||
    !heightEl ||
    !bmiEl
  ) {
    return;
  }

  const weight =
    parseFloat(weightEl.value);

  const height =
    parseFloat(heightEl.value) / 100;

  if (
    weight > 0 &&
    height > 0
  ) {

    bmiEl.value =
      (
        weight /
        (height * height)
      ).toFixed(1);

  }

  else {

    bmiEl.value = '';

  }

}

// =========================================================
// CONFIGURATION
// =========================================================

async function addDepartment(event) {

    event.preventDefault();

    const input =
        document.getElementById('cfg-dept-name');

    if (!input) {
        return;
    }

    const name =
        input.value.trim();

    if (!name) {

        alert(
            'Enter a department name.'
        );

        return;
    }

    try {

        const response = await fetch(
            '/api/departments/',
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                credentials: 'same-origin',

                body: JSON.stringify({
                    name: name,
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok || !data.success) {

            alert(
                data.message ||
                data.error ||
                'Unable to create department.'
            );

            return;
        }

        /*
         * PostgreSQL has successfully created
         * the department.
         *
         * Keep the returned name in the current
         * HMS state so the existing UI continues
         * displaying it.
         */

        const createdDepartment =
            data.department;

        if (
            createdDepartment &&
            createdDepartment.name
        ) {

            if (
                !Array.isArray(
                    state.config.departments
                )
            ) {
                state.config.departments = [];
            }

            state.config.departments.push(
                createdDepartment
            );
        }

        logAudit(
            `Department added: ${createdDepartment?.name || name}`
        );

        event.target.reset();

        refreshUI();

        alert(
            'Department created successfully.'
        );

    } catch (error) {

        console.error(
            'CREATE DEPARTMENT ERROR:',
            error
        );

        alert(
            'Unable to connect to the HMS server.'
        );
    }
}

function addService(event) {

  event.preventDefault();

  const nameEl =
    document.getElementById(
      'cfg-service-name'
    );

  const feeEl =
    document.getElementById(
      'cfg-service-fee'
    );

  if (
    !nameEl ||
    !feeEl
  ) {
    return;
  }

  const name =
    nameEl.value.trim();

  const fee =
    parseFloat(feeEl.value) || 0;

  if (!name) {

    alert(
      'Enter a service name.'
    );

    return;

  }

  state.config.services.push({

    id:
      `SRV-${Date.now()}`,

    name,

    fee

  });

  logAudit(
    `Tariff added: ${name} - ${money(fee)}`
  );

  event.target.reset();

  refreshUI();

}

// =========================================================
// STAFF DEPARTMENT SELECT
// =========================================================

async function populateStaffDepartmentSelect() {

    const select =
        document.getElementById('st-dept');

    if (!select) {
        return;
    }

    const currentValue =
        select.value;

    try {

        const response =
            await fetch('/api/departments/');

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to load departments.'
            );

        }

        select.innerHTML = `
            <option value="">
                Select Department
            </option>
        `;

        data.departments.forEach(
            department => {

                const option =
                    document.createElement(
                        'option'
                    );

                /*
                 * PostgreSQL department ID
                 */
                option.value =
                    String(
                        department.id
                    );

                /*
                 * Human-readable name
                 */
                option.textContent =
                    department.name;

                select.appendChild(
                    option
                );

            }
        );

        if (
            currentValue &&
            [
                ...select.options
            ].some(
                option =>
                    option.value ===
                    String(currentValue)
            )
        ) {

            select.value =
                String(currentValue);

        }

    } catch (error) {

        console.error(
            'Department loading error:',
            error
        );

        select.innerHTML = `
            <option value="">
                Unable to load departments
            </option>
        `;

    }

}

// =========================================================
// RECEPTION — LOAD DEPARTMENTS FROM POSTGRESQL
// =========================================================

async function populateReceptionDepartmentSelect() {

    const select =
        document.getElementById('reg-clinic');

    if (!select) {
        return;
    }

    const currentValue =
        select.value;

    try {

        const response =
            await fetch(
                '/api/departments/',
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store'
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.message ||
                data.error ||
                'Unable to load departments.'
            );
        }

        select.innerHTML = `
            <option value="">
                Select Department
            </option>
        `;

        data.departments.forEach(
            department => {

                const option =
                    document.createElement(
                        'option'
                    );

                /*
                 * REAL PostgreSQL department ID
                 */
                option.value =
                    String(
                        department.id
                    );

                /*
                 * REAL department name
                 */
                option.textContent =
                    department.name;

                /*
                 * Keep the name available
                 * without using it as the value.
                 */
                option.dataset.departmentName =
                    department.name;

                select.appendChild(
                    option
                );
            }
        );

        if (
            currentValue &&
            [
                ...select.options
            ].some(
                option =>
                    option.value ===
                    String(currentValue)
            )
        ) {

            select.value =
                String(currentValue);

        }

    } catch (error) {

        console.error(
            'Reception department loading error:',
            error
        );

        select.innerHTML = `
            <option value="">
                Unable to load departments
            </option>
        `;
    }
}

// =========================================================
// LOAD STAFF FROM DATABASE
// =========================================================

async function loadStaffFromDatabase() {

    const table =
        document.getElementById(
            'admin-staff-table'
        );

    if (!table) {
        return;
    }

    table.innerHTML = `
        <tr>
            <td
                colspan="7"
                style="text-align:center;"
            >
                Loading staff...
            </td>
        </tr>
    `;

    try {

        const response =
            await fetch('/api/staff/');

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to load staff.'
            );

        }

        const staffList =
            Array.isArray(data.staff)
                ? data.staff
                : [];

        /*
         * Keep state.staff as a cache for
         * existing HMS functions.
         *
         * Database remains the source of truth.
         */

        state.staff =
            staffList.map(staff => ({

                id: staff.id,

                staff_id:
                    staff.staff_id ||
                    staff.staff_number,

                name:
                    staff.name ||
                    staff.full_name,

                full_name:
                    staff.full_name ||
                    staff.name,

                department_id: null,
                dept: '',

                role:
                    staff.role,

                phone:
                    staff.phone || '',

                email:
                    staff.email || '',

                status:
                    staff.status ||
                    staff.shift_status ||
                    'OFF DUTY'

            }));

        if (staffList.length === 0) {

            table.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        style="text-align:center;"
                    >
                        No staff entries found.
                    </td>
                </tr>
            `;

            return;
        }

        table.innerHTML =
            staffList.map(staff => `

                <tr>

                    <td>
                        ${escapeHTML(
                            staff.staff_id ||
                            staff.staff_number ||
                            staff.id
                        )}
                    </td>

                    <td>
                        ${escapeHTML(
                            staff.full_name ||
                            staff.name ||
                            ''
                        )}
                    </td>

                    <td>
                        ${escapeHTML(
                            staff.role ||
                            ''
                        )}
                    </td>

                    <td>
                        ${escapeHTML(
                            staff.phone ||
                            ''
                        )}
                    </td>

                    <td>
                        ${escapeHTML(
                            staff.email ||
                            ''
                        )}
                    </td>

                    <td>

                        <span class="badge badge-p3">
                            ${escapeHTML(
                                staff.status ||
                                staff.shift_status ||
                                'OFF DUTY'
                            )}
                        </span>

                    </td>

                    <td>

                        <button
                            type="button"
                            class="btn btn-primary btn-sm"
                            onclick="editStaff(${staff.id})"
                        >
                            Edit
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger btn-sm"
                            onclick="deleteStaff(${staff.id})"
                        >
                            Delete
                        </button>

                    </td>

                </tr>

            `).join('');

    } catch (error) {

        console.error(
            'Staff loading error:',
            error
        );

        table.innerHTML = `
            <tr>
                <td
                    colspan="7"
                    style="text-align:center;color:red;"
                >
                    Unable to load staff.
                </td>
            </tr>
        `;

    }

}


// =========================================================
// INVENTORY
// DATABASE-BACKED
// NO state.inventory
// NO localStorage
// =========================================================

// =========================================================
// GENERIC INVENTORY RESPONSE
// =========================================================

async function inventoryResponse(response) {

    const text = await response.text();

    let data = {};

    try {

        data = text
            ? JSON.parse(text)
            : {};

    } catch (error) {

        throw new Error(
            `Server returned invalid JSON (${response.status}).`
        );

    }

    if (!response.ok) {

        throw new Error(
            data.error ||
            data.message ||
            `Inventory server error (${response.status}).`
        );

    }

    return data;
}

// =========================================================
// LOAD INVENTORY FROM DATABASE
// =========================================================

// =========================================================
// LOAD INVENTORY FROM DATABASE
// SINGLE DATABASE SOURCE OF TRUTH
// =========================================================

async function loadInventoryFromDatabase() {

  try {

    const response =
      await fetch(
        '/api/pharmacy/inventory',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        data.message ||
        'Unable to load inventory.'
      );

    }

    const inventory =
      Array.isArray(data.items)
        ? data.items
        : [];

    // DATABASE IS THE SOURCE OF TRUTH
    state.inventory =
      inventory;

    renderInventoryLedger(
      inventory
    );

    populateInventorySelect(
      inventory
    );

    return inventory;

  } catch (error) {

    console.error(
      'HMS INVENTORY LOAD ERROR:',
      error
    );

    state.inventory = [];

    renderInventoryLedger(
      []
    );

    populateInventorySelect(
      []
    );

    throw error;

  }

}
// =========================================================
// RENDER STOCK CONTROL LEDGER
// DATABASE DATA ONLY
//
// IMPORTANT:
// For TABLETS:
// item.quantity = NUMBER OF BOXES
// item.strips_per_box = STRIPS IN EACH BOX
//
// Example:
// quantity = 10
// strips_per_box = 10
//
// Display:
// 10 Boxes + 0 Strips = 100 Strips
//
// Consumption/decrement conversion is NOT handled here.
// It will be handled by the consumption API later.
// =========================================================

function renderInventoryLedger(items) {

    const categories = {

        "Drug Stock":
            document.getElementById(
                'admin-inv-drug-table'
            ),

        "Medical Supplies":
            document.getElementById(
                'admin-inv-supplies-table'
            ),

        "Equipment":
            document.getElementById(
                'admin-inv-equipment-table'
            )

    };

    // ---------------------------------------------------------
    // INITIALIZE ALL TABLES
    // ---------------------------------------------------------

    Object.values(categories).forEach(
        table => {

            if (table) {

                table.innerHTML = `
                    <tr>
                        <td
                            colspan="6"
                            style="text-align:center;"
                        >
                            No stock items found.
                        </td>
                    </tr>
                `;

            }

        }
    );

    // ---------------------------------------------------------
    // RENDER DATABASE ITEMS
    // ---------------------------------------------------------

    items.forEach(item => {

        const table =
            categories[item.category];

        if (!table) {
            return;
        }

        const quantity =
            Number(item.quantity || 0);

        const reorder =
            Number(item.reorder_level || 0);

        let lowStock =
            quantity <= reorder;

        let reorderDisplay = reorder;

        let stockDisplay =
            quantity;

        // -----------------------------------------------------
        // TABLET STOCK
        //
        // quantity IS BOXES.
        //
        // We do NOT divide quantity by strips_per_box.
        //
        // Example:
        //
        // quantity = 10 boxes
        // strips_per_box = 10
        //
        // boxes = 10
        // loose strips = 0
        // total strips = 100
        // -----------------------------------------------------

        if (
            item.category === 'Drug Stock' &&
            String(item.drug_type || '')
                .toLowerCase() === 'tablets' &&
            Number(item.strips_per_box) > 0
        ) {

            const boxes =
                quantity;

            const stripsPerBox =
                Number(
                    item.strips_per_box
                );

            const looseStrips =
              Number(
                item.loose_strips || 0
              );

            const totalStrips = (
                boxes * stripsPerBox
            ) + looseStrips;

            lowStock = totalStrips <= reorder * stripsPerBox;
            reorderDisplay = `${reorder} Box${reorder !== 1 ? 'es' : ''} (${reorder * stripsPerBox} Strips)`;

            stockDisplay =
                `${boxes} Box${boxes !== 1 ? 'es' : ''} + ` +
                `${looseStrips} Strip${looseStrips !== 1 ? 's' : ''} ` +
                `= ${totalStrips} Strips`;

        }

        // -----------------------------------------------------
        // CREATE ROW
        // -----------------------------------------------------

        const row =
            document.createElement('tr');

        row.innerHTML = `

            <td>
                ${escapeHTML(
                    item.item_code || ''
                )}
            </td>

            <td>
                ${escapeHTML(
                    item.item_name || ''
                )}

                ${
                    item.drug_type
                        ? `
                            <small>
                                ${escapeHTML(
                                    item.drug_type
                                )}
                            </small>
                          `
                        : ''
                }
            </td>

            <td>
                ${escapeHTML(
                    item.valuation_method || ''
                )}
            </td>

            <td>

                <strong>
                    ${stockDisplay}
                </strong>

                ${
                    lowStock
                        ? `
                            <span
                                class="badge badge-p1"
                            >
                                Low
                            </span>
                          `
                        : ''
                }

            </td>

            <td>
                ${reorderDisplay}
            </td>

            <td>
                ${escapeHTML(
                    item.supplier || 'N/A'
                )}
            </td>

        `;

        table.appendChild(row);

    });

    // ---------------------------------------------------------
    // REMOVE EMPTY-STATE ROW WHEN CATEGORY HAS ITEMS
    // ---------------------------------------------------------

    Object.entries(categories).forEach(
        ([category, table]) => {

            if (!table) {
                return;
            }

            const categoryItems =
                items.filter(
                    item =>
                        item.category === category
                );

            if (categoryItems.length > 0) {

                const emptyRow =
                    table.querySelector(
                        'tr td[colspan="6"]'
                    );

                if (emptyRow) {

                    emptyRow.parentElement.remove();

                }

            }

        }
    );

}

// =========================================================
// POPULATE PHARMACY INVENTORY SELECT
// DATABASE DATA ONLY
// =========================================================

function populateInventorySelect(items) {

    const select =
        document.getElementById(
            'p-item-select'
        );

    if (!select) {
        return;
    }

    const currentValue =
        select.value;

    select.innerHTML = `

        <option value="">
            Select Inventory Item
        </option>

    `;

    items.forEach(item => {

        const option =
            document.createElement(
                'option'
            );

        option.value =
            String(item.id);

        option.textContent =
            `${item.item_code} - ${item.item_name}`;

        option.dataset.itemCode =
            item.item_code;

        option.dataset.quantity =
            item.quantity;

        option.dataset.category =
            item.category;

        select.appendChild(
            option
        );

    });

    if (
        currentValue &&
        Array.from(
            select.options
        ).some(
            option =>
                option.value ===
                String(currentValue)
        )
    ) {

        select.value =
            String(currentValue);

    }

}

// =========================================================
// ADD INVENTORY ITEM
// DATABASE-BACKED
// =========================================================

async function addInventoryItem(event) {

    event.preventDefault();

    // -----------------------------------------------------
    // READ FORM
    // -----------------------------------------------------

    const code =
        document.getElementById(
            'inv-code'
        )?.value.trim();

    const name =
        document.getElementById(
            'inv-name'
        )?.value.trim();

    const category =
        document.getElementById(
            'inv-cat'
        )?.value.trim();

    const drugType =
        document.getElementById(
            'inv-drug-type'
        )?.value || null;

    const valuationMethod =
        document.getElementById(
            'inv-valuation-method'
        )?.value.trim();

    const stripsPerBoxInput =
        document.getElementById(
            'inv-strips-per-box'
        );

    const pricePerUnitInput = document.getElementById('inv-price-per-unit');
    const pricePerUnit = Number(pricePerUnitInput?.value || 0);
    const pricePerBoxInput = document.getElementById('inv-price-per-box');
    const pricePerBox = pricePerBoxInput?.value === '' ? null : Number(pricePerBoxInput?.value);

    const quantity =
        parseInt(
            document.getElementById(
                'inv-qty'
            )?.value,
            10
        );

    const reorderLevel =
        parseInt(
            document.getElementById(
                'inv-reorder'
            )?.value,
            10
        );

    const supplier =
        document.getElementById(
            'inv-supplier'
        )?.value.trim() || '';

    const expiryDate = document.getElementById('inv-expiry-date')?.value || null;

    const stripsPerBox =
        stripsPerBoxInput &&
        stripsPerBoxInput.value
            ? parseInt(
                stripsPerBoxInput.value,
                10
              )
            : null;

    // -----------------------------------------------------
    // VALIDATION
    // -----------------------------------------------------

    if (!code || !name) {

        alert(
            'Item code and item name are required.'
        );

        return;
    }

    if (!category) {

        alert(
            'Please select an inventory category.'
        );

        return;
    }

    if (!valuationMethod) {

        alert(
            'Please select a valuation method.'
        );

        return;
    }

    if (category === 'Drug Stock' && (!Number.isFinite(pricePerUnit) || pricePerUnit < 0 || pricePerUnitInput?.value === '')) {
        alert('Enter the stocking cost per strip, bottle, or tube.');
        pricePerUnitInput?.focus();
        return;
    }

    const tabletDrug = category === 'Drug Stock' && String(drugType || '').toLowerCase() === 'tablets';
    if (tabletDrug && (!Number.isFinite(pricePerBox) || pricePerBox < 0 || pricePerBoxInput?.value === '')) {
        alert('Enter the stocking cost for one complete box of tablets.');
        pricePerBoxInput?.focus();
        return;
    }

    if (
        !Number.isInteger(quantity) ||
        quantity < 0
    ) {

        alert(
            'Enter a valid stock quantity.'
        );

        return;
    }

    if (
        !Number.isInteger(reorderLevel) ||
        reorderLevel < 0
    ) {

        alert(
            'Enter a valid reorder level.'
        );

        return;
    }

    // -----------------------------------------------------
    // TABLET VALIDATION
    // -----------------------------------------------------

    if (
        category === 'Drug Stock' &&
        String(drugType || '')
            .toLowerCase() === 'tablets'
    ) {

        if (
            !Number.isInteger(
                stripsPerBox
            ) ||
            stripsPerBox <= 0
        ) {

            alert(
                'Enter the number of strips per box.'
            );

            return;
        }

    }

    // -----------------------------------------------------
    // SEND TO POSTGRESQL THROUGH FLASK API
    // -----------------------------------------------------

    try {

        const response =
            await fetch(
                '/api/inventory/',
                {
                    method: 'POST',

                    credentials:
                        'same-origin',

                    headers: {
                        'Content-Type':
                            'application/json',

                        'Accept':
                            'application/json'
                    },

                    body:
                        JSON.stringify({

                            item_code:
                                code,

                            item_name:
                                name,

                            category:
                                category,

                            drug_type:
                                drugType,

                            valuation_method:
                                valuationMethod,

                            strips_per_box:
                                stripsPerBox,

                            price_per_unit:
                                pricePerUnit,

                            price_per_box:
                                tabletDrug ? pricePerBox : null,

                            quantity:
                                quantity,

                            reorder_level:
                                reorderLevel,

                            supplier:
                                supplier,

                            expiry_date:
                                expiryDate

                        })
                }
            );

        const data =
            await inventoryResponse(
                response
            );

        // -------------------------------------------------
        // DATABASE CONFIRMED
        // -------------------------------------------------

        console.log(
            'INVENTORY DATABASE RESPONSE:',
            data
        );

        // -------------------------------------------------
        // RESET FORM
        // -------------------------------------------------

        event.target.reset();

        // -------------------------------------------------
        // HIDE TABLET-SPECIFIC FIELDS
        // -------------------------------------------------

        const drugWrapper =
            document.getElementById(
                'drug-type-wrapper'
            );

        const tabletWrapper =
            document.getElementById(
                'tablet-box-wrapper'
            );

        const tabletNote =
            document.getElementById(
                'tablet-valuation-note'
            );

        if (drugWrapper) {
            drugWrapper.style.display =
                'none';
        }

        if (tabletWrapper) {
            tabletWrapper.style.display =
                'none';
        }

        if (tabletNote) {
            tabletNote.style.display =
                'none';
        }

        // -------------------------------------------------
        // RELOAD DIRECTLY FROM DATABASE
        // -------------------------------------------------

        await loadInventoryFromDatabase();

        // -------------------------------------------------
        // MESSAGE
        // -------------------------------------------------

        alert(
            data.message ||
            (
                data.action === 'stock_added'
                    ? 'Existing stock quantity increased successfully.'
                    : 'New inventory item added successfully.'
            )
        );

    } catch (error) {

        console.error(
            'INVENTORY SAVE ERROR:',
            error
        );

        alert(
            error.message ||
            'Unable to save inventory item.'
        );

    }

}

// =========================================================
// INVENTORY CATEGORY CHANGE
// =========================================================

function handleInventoryCategoryChange() {

    const category =
        document.getElementById(
            'inv-cat'
        )?.value;

    const drugWrapper =
        document.getElementById(
            'drug-type-wrapper'
        );

    const drugType =
        document.getElementById(
            'inv-drug-type'
        );

    const valuation =
        document.getElementById(
            'inv-valuation-method'
        );

    const tabletWrapper =
        document.getElementById(
            'tablet-box-wrapper'
        );

    const tabletNote =
        document.getElementById(
            'tablet-valuation-note'
        );

    if (!valuation) {
        return;
    }

    valuation.innerHTML = `

        <option value="">
            -- Select Valuation Method --
        </option>

    `;

    if (category === 'Drug Stock') {

        if (drugWrapper) {

            drugWrapper.style.display =
                'block';

        }

        valuation.innerHTML += `

            <option value="Strips / Boxes">
                Strips / Boxes
            </option>

            <option value="Bottles">
                Bottles
            </option>

            <option value="Tubes">
                Tubes
            </option>

        `;

    } else {

        if (drugWrapper) {

            drugWrapper.style.display =
                'none';

        }

        if (drugType) {

            drugType.value =
                '';

        }

        if (category === 'Medical Supplies') {

            valuation.innerHTML += `

                <option value="Pieces">
                    Pieces
                </option>

                <option value="Boxes">
                    Boxes
                </option>

                <option value="Packs">
                    Packs
                </option>

            `;

        }

        if (category === 'Equipment') {

            valuation.innerHTML += `

                <option value="Units">
                    Units
                </option>

            `;

        }

    }

    updateDrugValuationMethod();

}

// =========================================================
// UPDATE DRUG VALUATION METHOD
// =========================================================

function updateDrugValuationMethod() {

    const category =
        document.getElementById(
            'inv-cat'
        )?.value;

    const drugType =
        document.getElementById(
            'inv-drug-type'
        )?.value;

    const valuation =
        document.getElementById(
            'inv-valuation-method'
        );

    const tabletWrapper =
        document.getElementById(
            'tablet-box-wrapper'
        );

    const tabletNote =
        document.getElementById(
            'tablet-valuation-note'
        );

    if (!valuation) {
        return;
    }

    // Show the dispensing-cost input as soon as a Drug Stock type is selected,
    // including tablets (whose stock handling returns early below).
    const priceWrapper = document.getElementById('inv-price-wrapper');
    const priceLabel = document.getElementById('inv-price-label');
    const priceHelp = document.getElementById('inv-price-help');
    const priceInput = document.getElementById('inv-price-per-unit');
    const priceBoxWrapper = document.getElementById('inv-price-box-wrapper');
    const isDrug = category === 'Drug Stock' && Boolean(drugType);
    if (priceWrapper) priceWrapper.style.display = isDrug ? 'block' : 'none';
    if (priceBoxWrapper) priceBoxWrapper.style.display = isDrug && String(drugType).toLowerCase() === 'tablets' ? 'block' : 'none';
    const priceConfig = {
        tablets: ['Stocking cost per strip', 'This strip cost is billed when strips are dispensed. Enter the box cost separately below.'],
        syrups: ['Stocking cost per bottle', 'This bottle cost is billed when syrup is dispensed.'],
        cream: ['Stocking cost per tube', 'This tube cost is billed when cream is dispensed.']
    }[drugType];
    if (priceConfig && priceLabel && priceHelp) {
        priceLabel.textContent = priceConfig[0];
        priceHelp.textContent = priceConfig[1];
        if (priceInput) priceInput.placeholder = priceConfig[0];
    }

    if (
        category === 'Drug Stock' &&
        drugType === 'tablets'
    ) {

        valuation.value =
            'Strips / Boxes';

        valuation.disabled =
            true;

        if (tabletWrapper) {

            tabletWrapper.style.display =
                'block';

        }

        if (tabletNote) {

            tabletNote.style.display =
                'block';

        }

        return;

    }

    valuation.disabled =
        false;

    if (tabletWrapper) {

        tabletWrapper.style.display =
            'none';

    }

    if (tabletNote) {

        tabletNote.style.display =
            'none';

    }

    if (
        category === 'Drug Stock' &&
        drugType === 'syrups'
    ) {

        valuation.value =
            'Bottles';

    }

    if (
        category === 'Drug Stock' &&
        drugType === 'cream'
    ) {

        valuation.value =
            'Tubes';

    }

}

// =========================================================
// OPEN STOCK CONTROL LEDGER
// =========================================================

async function openStockLedger() {

    const overlay =
        document.getElementById(
            'stock-ledger-overlay'
        );

    if (!overlay) {

        console.error(
            'Stock ledger overlay not found.'
        );

        return;
    }

    overlay.classList.add(
        'active'
    );

    overlay.setAttribute(
        'aria-hidden',
        'false'
    );

    document.body.style.overflow =
        'hidden';

    // Always obtain current
    // stock from PostgreSQL.

    await loadInventoryFromDatabase();

}

// =========================================================
// CLOSE STOCK CONTROL LEDGER
// =========================================================

function closeStockLedger() {

    const overlay =
        document.getElementById(
            'stock-ledger-overlay'
        );

    if (!overlay) {
        return;
    }

    overlay.classList.remove(
        'active'
    );

    overlay.setAttribute(
        'aria-hidden',
        'true'
    );

    document.body.style.overflow =
        '';

}

// =========================================================
// LOAD INVENTORY WHEN ADMIN INVENTORY TAB OPENS
// =========================================================

async function initializeInventoryModule() {

    await loadInventoryFromDatabase();

}

// =========================================================
// ESCAPE KEY CLOSES LEDGER
// =========================================================

document.addEventListener(
    'keydown',
    function(event) {

        if (
            event.key === 'Escape'
        ) {

            const overlay =
                document.getElementById(
                    'stock-ledger-overlay'
                );

            if (
                overlay &&
                overlay.classList.contains(
                    'active'
                )
            ) {

                closeStockLedger();

            }

        }

    }
);


// =========================================================
// PATIENT ID
// =========================================================

function generatePatientId() {

  let id;

  do {

    id =
      `P-${Math.floor(
        1000 +
        Math.random() * 9000
      )}`;

  } while (
    state.patients.some(
      patient =>
        patient.id === id
    )
  );

  return id;

}



// =========================================================
// CANONICAL HMS ROLE
// Converts all accepted variations into ONE role name
// =========================================================

function getCanonicalHMSRole(role) {

  const normalized =
    normalizeHMSRole(role);

  // -------------------------------------------------------
  // ADMIN
  // -------------------------------------------------------

  if (
    normalized === 'system admin' ||
    normalized === 'system administrator' ||
    normalized === 'system administrator user'
  ) {
    return 'system_admin';
  }

  if (
    normalized === 'hospital manager' ||
    normalized === 'hospital admin' ||
    normalized === 'hospital administrator' ||
    normalized === 'hospital admin user'
  ) {
    return 'hospital_manager';
  }

  if (
    normalized === 'admin' ||
    normalized === 'administrator' ||
    normalized === 'admin user'
  ) {
    return 'system_admin';
  }

  // -------------------------------------------------------
  // DOCTOR
  // -------------------------------------------------------

  if (
    normalized === 'doctor' ||
    normalized === 'physician' ||
    normalized === 'medical doctor'
  ) {
    return 'doctor';
  }

  // -------------------------------------------------------
  // NURSE
  // -------------------------------------------------------

  if (
    normalized === 'nurse' ||
    normalized === 'nursing officer' ||
    normalized === 'nursing'
  ) {
    return 'nurse';
  }

  // -------------------------------------------------------
  // LABORATORY
  // -------------------------------------------------------

  if (
    normalized === 'lab tech' ||
    normalized === 'lab technician' ||
    normalized === 'laboratory technician' ||
    normalized === 'laboratory tech' ||
    normalized === 'lab technologist' ||
    normalized === 'laboratory technologist'
  ) {
    return 'labtech';
  }

  // -------------------------------------------------------
  // PHARMACY
  // -------------------------------------------------------

  if (
    normalized === 'pharmacist' ||
    normalized === 'pharmacy'
  ) {
    return 'pharmacist';
  }

  // -------------------------------------------------------
  // RADIOLOGY
  // -------------------------------------------------------

  if (
    normalized === 'radiologist' ||
    normalized === 'radiology'
  ) {
    return 'radiologist';
  }

  // -------------------------------------------------------
  // SURGERY / THEATRE
  // -------------------------------------------------------

  if (
    normalized === 'surgeon' ||
    normalized === 'surgery' ||
    normalized === 'theatre' ||
    normalized === 'operating theatre'
  ) {
    return 'surgeon';
  }

  // -------------------------------------------------------
  // RECEPTION
  // -------------------------------------------------------

  if (
    normalized === 'opd' ||
    normalized === 'opd officer' ||
    normalized === 'opd user'
  ) {
    return 'opd';
  }

  if (
    normalized === 'receptionist' ||
    normalized === 'reception'
  ) {
    return 'receptionist';
  }

  // -------------------------------------------------------
  // ACCOUNTS
  // -------------------------------------------------------

  if (
    normalized === 'accountant' ||
    normalized === 'finance' ||
    normalized === 'finance officer' ||
    normalized === 'finance manager' ||
    normalized === 'accounts' ||
    normalized === 'billing' ||
    normalized === 'accounts officer'
  ) {
    return 'accountant';
  }

  // -------------------------------------------------------
  // OFFICE / SUPPORT MODULE ROLES
  // -------------------------------------------------------
  if (['secretary', 'secretariate', 'secretariat', 'secretary officer'].includes(normalized)) {
    return 'secretary';
  }
  if (['procurement officer', 'procurement', 'purchasing officer', 'purchasing'].includes(normalized)) {
    return 'procurement_officer';
  }
  if (['guidance counselor', 'guidance and counseling', 'guidance & counseling', 'guidance and counselling', 'counselor', 'counsellor'].includes(normalized)) {
    return normalized === 'counselor' || normalized === 'counsellor' ? 'counselor' : 'guidance_counselor';
  }

  // -------------------------------------------------------
  // UNKNOWN ROLE
  // -------------------------------------------------------

  return normalized;

}

function getPatientAssignedClinic(patient) {

  if (!patient) {
    return '';
  }

  return String(
    patient.assignedClinic ||
    patient.vitals?.assignedClinic ||
    ''
  ).trim();

}

function patientBelongsToClinic(
  patient,
  clinic
) {

  if (!patient || !clinic) {
    return false;
  }

  return (
    normalizeClinicName(
      getPatientAssignedClinic(patient)
    ) ===
    normalizeClinicName(clinic)
  );

}


// =========================================================
// =========================================================
// RECEPTION MODULE
// DATABASE-BACKED PATIENT REGISTRATION
//
// WORKFLOW:
//
// RECEPTION
//     ↓
// REGISTER PATIENT
//     ↓
// DATABASE PATIENT
//     ↓
// DATABASE VISIT
//     ↓
// TRIAGE QUEUE
//     ↓
// TRIAGE NURSE ASSIGNS CLINICAL DEPARTMENT
//
// IMPORTANT:
// Reception does NOT:
// - assign department/clinic
// - assign doctor
// - collect consultation fee
// - create billing records
// - generate fake patient IDs
// - create fake local visits
//
// The Flask/PostgreSQL backend is the source of truth.
// =========================================================
// =========================================================

// =========================================================
// LAST REGISTERED PATIENT
//
// Holds the actual patient returned by the database.
// Used by the Print button.
// =========================================================

let lastRegisteredPatient = null;

function escapePatientMatchHtml(value) {
  const element = document.createElement('span');
  element.textContent = value == null ? '' : String(value);
  return element.innerHTML;
}

function choosePatientMatch(matches) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('patient-match-dialog');
    const options = document.getElementById('patient-match-options');
    if (!dialog || !options) {
      resolve(null);
      return;
    }

    const close = (choice) => {
      dialog.hidden = true;
      options.replaceChildren();
      dialog.removeEventListener('click', onBackdropClick);
      document.removeEventListener('keydown', onKeyDown);
      resolve(choice);
    };
    const onBackdropClick = (event) => {
      if (event.target === dialog) close(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close(null);
    };

    options.innerHTML = matches.map((match, index) => {
      const lastVisit = match.last_visit_date ? new Date(match.last_visit_date).toLocaleString() : 'No recorded visit';
      const matchReasons = (match.match_reasons || []).map((reason) => ({
        name_and_date_of_birth: 'Name and date of birth match',
        national_id: 'National ID match',
        phone: 'Phone number match'
      }[reason] || reason)).join(' · ');
      return `<button type="button" class="patient-match-option" data-patient-match-index="${index}" data-patient-id="${Number(match.id)||''}">
        <strong>${escapePatientMatchHtml(match.full_name)} — ${escapePatientMatchHtml(match.patient_id)}</strong>
        <span>DOB: ${escapePatientMatchHtml(match.date_of_birth || 'Not recorded')} · ${escapePatientMatchHtml(match.gender || 'Gender not recorded')} · Phone: ${escapePatientMatchHtml(match.phone || 'Not recorded')}</span>
        <dl class="patient-match-clinical-summary">
          <div><dt>Last visit</dt><dd>${escapePatientMatchHtml(lastVisit)}</dd></div>
          <div><dt>Visits</dt><dd>${escapePatientMatchHtml(match.visit_count || 0)}</dd></div>
          <div><dt>Chief complaint</dt><dd>${escapePatientMatchHtml(match.last_chief_complaint || 'Not recorded')}</dd></div>
          <div><dt>Latest diagnosis</dt><dd>${escapePatientMatchHtml(match.last_diagnosis || 'Not recorded')}</dd></div>
        </dl>
        ${matchReasons ? `<small>Why this matched: ${escapePatientMatchHtml(matchReasons)}</small>` : ''}
      </button>`;
    }).join('');
    options.querySelectorAll('[data-patient-match-index]').forEach((button) => {
      button.addEventListener('click', () => close(matches[Number(button.dataset.patientMatchIndex)]));
    });
    dialog.querySelector('[data-patient-match-new]').onclick = () => close(false);
    dialog.querySelector('[data-patient-match-cancel]').onclick = () => close(null);
    dialog.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown);
    dialog.hidden = false;
    options.querySelector('button')?.focus();
  });
}

// =========================================================
// RECEPTION — REGISTER PATIENT
// =========================================================

async function registerPatient(event) {

  event.preventDefault();

  // -------------------------------------------------------
  // READ FORM VALUES
  // -------------------------------------------------------

  const name =
    document
      .getElementById('reg-name')
      ?.value
      .trim();

  const dob =
    document
      .getElementById('reg-dob')
      ?.value
      .trim();

  const gender =
    document
      .getElementById('reg-gender')
      ?.value
      .trim();

  const phone =
    document
      .getElementById('reg-phone')
      ?.value
      .trim();

  const nationalId =
    document.getElementById('reg-national-id')?.value.trim() || '';

  // -------------------------------------------------------
  // VALIDATION
  // -------------------------------------------------------

  if (!name) {

    alert(
      'Full name is required.'
    );

    return;
  }

  if (!dob) {

    alert(
      'Date of birth is required.'
    );

    return;
  }

  if (!gender) {

    alert(
      'Gender is required.'
    );

    return;
  }

  // -------------------------------------------------------
  // CHECK POSSIBLE RETURNING PATIENTS BEFORE CREATING A FILE
  // National ID is optional; name + DOB finds candidates.
  // -------------------------------------------------------

  let existingPatientId = null;

  try {
    const matchResponse = await fetch('/api/reception/matches', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ full_name: name, date_of_birth: dob, phone, national_id: nationalId })
    });
    const matchData = await matchResponse.json().catch(() => ({}));
    if (!matchResponse.ok || !matchData.success) throw new Error(matchData.message || 'Could not check existing patients.');

    const matches = matchData.matches || [];
    if (matches.length) {
      const match = await choosePatientMatch(matches);
      if (match === null) return;
      if (match) existingPatientId = match.id;
    }
  } catch (matchError) {
    console.error('PATIENT MATCH CHECK ERROR:', matchError);
    alert(matchError.message || 'Unable to check possible duplicate patients. Registration was not submitted.');
    return;
  }

  // -------------------------------------------------------
  // SUBMIT TO FLASK BACKEND
  // -------------------------------------------------------

  try {

    const response =
      await fetch(
        '/api/reception/register',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          credentials:
            'same-origin',

          body:
            JSON.stringify({

              full_name:
                name,

              date_of_birth:
                dob,

              gender:
                gender,

              phone:
                phone,

              national_id:
                nationalId,

              existing_patient_id:
                existingPatientId

            })

        }
      );

    // -----------------------------------------------------
    // READ SERVER RESPONSE
    // -----------------------------------------------------

    const data =
      await response.json();

    // -----------------------------------------------------
    // HANDLE FAILED REGISTRATION
    // -----------------------------------------------------

    if (
      !response.ok ||
      !data.success
    ) {

      console.error(
        'RECEPTION REGISTRATION ERROR:',
        data
      );

      alert(
        data.message ||
        data.error ||
        'Patient registration failed.'
      );

      return;
    }

    // -----------------------------------------------------
    // DATABASE PATIENT
    //
    // Backend returns:
    //
    // data.patient
    // data.visit
    // -----------------------------------------------------

    const patient =
      data.patient;

    const visit =
      data.visit;

    // -----------------------------------------------------
    // VERIFY PATIENT RESPONSE
    // -----------------------------------------------------

    if (
      !patient ||
      !patient.patient_id
    ) {

      console.error(
        'Invalid patient registration response:',
        data
      );

      alert(
        'Patient was saved, but the database did not return a valid Patient ID.'
      );

      return;
    }

    // -----------------------------------------------------
    // KEEP THE ACTUAL DATABASE PATIENT
    // -----------------------------------------------------

    lastRegisteredPatient = {

      id:
        patient.id,

      patient_id:
        patient.patient_id,

      full_name:
        patient.full_name,

      date_of_birth:
        patient.date_of_birth,

      gender:
        patient.gender,

      phone:
        patient.phone,

      clinic:
        patient.clinic || null,

      current_phase:
        patient.current_phase ||
        'Triage Queue',

      status:
        patient.status ||
        'Active',

      visit_id:
        visit?.visit_id ||
        null,

      visit_status:
        visit?.visit_status ||
        visit?.status ||
        'WAITING'

    };

    // -----------------------------------------------------
    // UPDATE FRONTEND HMS STATE
    //
    // This does NOT replace the database.
    // It only keeps the current UI synchronized.
    // -----------------------------------------------------

    if (
      typeof state !== 'undefined' &&
      Array.isArray(state.patients)
    ) {

      const statePatient = {

        id:
          patient.patient_id,

        patient_id:
          patient.patient_id,

        databaseId:
          patient.id,

        name:
          patient.full_name,

        full_name:
          patient.full_name,

        dob:
          patient.date_of_birth,

        date_of_birth:
          patient.date_of_birth,

        gender:
          patient.gender,

        phone:
          patient.phone,

        clinic:
          null,

        department_id:
          null,

        phase:
          'Triage Queue',

        current_phase:
          'Triage Queue',

        status:
          patient.status ||
          'Active',

        visit_id:
          visit?.visit_id ||
          null,

        visit_status:
          visit?.visit_status ||
          visit?.status ||
          'WAITING',

        vitals:
          {},

        history:
          {},

        diagnosis:
          'Unexamined',

        labRequest:
          'None',

        labOrders:
          [],

        labResult:
          '',

        radRequest:
          'None',

        radiologyOrders:
          [],

        radResult:
          '',

        prescription:
          'None',

        doctorNotes:
          [],

        referrals:
          [],

        followUp:
          null,

        doctorNotifications:
          [],

        bed:
          'Unassigned',

        reports:
          [],

        laboratoryHistory:
          [],

        radiologyHistory:
          [],

        nursingHistory:
          [],

        theatreHistory:
          [],

        medications:
          [],

        paymentHistory:
          [],

        billingFeed:
          [],

        createdAt:
          new Date().toISOString()

      };

      // ---------------------------------------------------
      // PREVENT DUPLICATE FRONTEND PATIENT
      // ---------------------------------------------------

      const existingIndex =
        state.patients.findIndex(
          item =>
            String(
              item.patient_id ||
              item.id ||
              ''
            ) ===
            String(
              patient.patient_id
            )
        );

      if (
        existingIndex >= 0
      ) {

        state.patients[
          existingIndex
        ] =
          statePatient;

      } else {

        state.patients.push(
          statePatient
        );

      }

    }

    // -----------------------------------------------------
    // AUDIT
    // -----------------------------------------------------

    if (
      typeof logAudit ===
      'function'
    ) {

      logAudit(
        `Patient registered at Reception: ${
          patient.patient_id
        } (${patient.full_name})`
      );

    }

    // -----------------------------------------------------
    // SHOW THE SAVED PATIENT
    // -----------------------------------------------------

    showPatientCard(
      lastRegisteredPatient
    );

    // -----------------------------------------------------
    // RESET REGISTRATION FORM
    // -----------------------------------------------------

    if (
      event.target
    ) {

      event.target.reset();

    }

    // -----------------------------------------------------
    // REFRESH HMS UI
    // -----------------------------------------------------

    if (
      typeof refreshUI ===
      'function'
    ) {

      refreshUI();

    }

    // -----------------------------------------------------
    // SUCCESS MESSAGE
    // -----------------------------------------------------

    alert(
      `Patient registered successfully.\n\n` +
      `Patient ID: ${
        patient.patient_id
      }\n\n` +
      `Patient has been sent to the Triage Queue.`
    );

  } catch (error) {

    // -----------------------------------------------------
    // NETWORK / SERVER ERROR
    // -----------------------------------------------------

    console.error(
      'RECEPTION REGISTRATION FAILED:',
      error
    );

    alert(
      'Unable to register the patient. ' +
      'Please check that the HMS server is running.'
    );

  }

}

// =========================================================
// SHOW OPD REPORT SLIDE
// =========================================================

function showOPDReportSlide(
  index
) {

  const slides =
    document.querySelectorAll(
      '.opd-report-slide'
    );

  if (
    !slides.length
  ) {

    return;

  }

  let targetIndex =
    Number(
      index
    );

  if (
    !Number.isInteger(
      targetIndex
    )
  ) {

    targetIndex =
      0;

  }

  if (
    targetIndex < 0
  ) {

    targetIndex =
      slides.length - 1;

  }

  if (
    targetIndex >= slides.length
  ) {

    targetIndex =
      slides.length - 1;

  }

  slides.forEach(
    function (
      slide,
      slideIndex
    ) {

      if (
        slideIndex ===
        targetIndex
      ) {

        slide.style.display =
          'block';

        slide.style.transform =
          'translateX(0)';

        slide.style.opacity =
          '1';

      }

      else {

        slide.style.display =
          'none';

        slide.style.transform =
          'translateX(100%)';

        slide.style.opacity =
          '0';

      }

    }
  );

  window.currentOPDReportSlide =
    targetIndex;

}

// =========================================================
// DISPLAY SAVED PATIENT CARD
// =========================================================

function showPatientCard(patient) {

  if (!patient) {

    return;
  }

  // -------------------------------------------------------
  // KEEP PATIENT AVAILABLE FOR PRINTING
  // -------------------------------------------------------

  lastRegisteredPatient =
    patient;

  // -------------------------------------------------------
  // PATIENT ID
  // -------------------------------------------------------

  setReceptionCardText(
    'card-id',
    patient.patient_id ||
    patient.id ||
    ''
  );

  // -------------------------------------------------------
  // NAME
  // -------------------------------------------------------

  setReceptionCardText(
    'card-name',
    patient.full_name ||
    patient.name ||
    ''
  );

  // -------------------------------------------------------
  // DATE OF BIRTH
  // -------------------------------------------------------

  setReceptionCardText(
    'card-dob',
    patient.date_of_birth ||
    patient.dob ||
    ''
  );

  // -------------------------------------------------------
  // GENDER
  // -------------------------------------------------------

  setReceptionCardText(
    'card-gender',
    patient.gender ||
    ''
  );

  // -------------------------------------------------------
  // PHONE
  // -------------------------------------------------------

  setReceptionCardText(
    'card-phone',
    patient.phone ||
    ''
  );

  // -------------------------------------------------------
  // SHOW PATIENT CARD
  // -------------------------------------------------------

  const card =
    document.getElementById(
      'pt-card-print'
    );

  if (card) {

    card.style.display =
      'block';

  }

}

// =========================================================
// SAFE TEXT SETTER
//
// Uses textContent so patient information is not interpreted
// as HTML.
// =========================================================

function setReceptionCardText(
  elementId,
  value
) {

  const element =
    document.getElementById(
      elementId
    );

  if (!element) {

    return;
  }

  element.textContent =
    value ?? '';

}

// =========================================================
// PRINT PATIENT CARD
//
// Prints ONLY the patient card.
// Does not print the Reception form.
// Does not print the HMS sidebar.
// Does not print the rest of the page.
// =========================================================

function printPatientCard() {

  // -------------------------------------------------------
  // VERIFY PATIENT
  // -------------------------------------------------------

  if (
    !lastRegisteredPatient
  ) {

    alert(
      'No registered patient is available to print.'
    );

    return;
  }

  const patient =
    lastRegisteredPatient;

  // -------------------------------------------------------
  // OPEN PRINT WINDOW
  // -------------------------------------------------------

  const printWindow =
    window.open(
      '',
      '_blank',
      'width=800,height=700'
    );

  if (!printWindow) {

    alert(
      'Please allow pop-ups to print the patient card.'
    );

    return;
  }

  // -------------------------------------------------------
  // PATIENT DATA
  // -------------------------------------------------------

  const patientId =
    escapeReceptionHtml(
      patient.patient_id ||
      patient.id ||
      ''
    );

  const fullName =
    escapeReceptionHtml(
      patient.full_name ||
      patient.name ||
      ''
    );

  const dateOfBirth =
    escapeReceptionHtml(
      patient.date_of_birth ||
      patient.dob ||
      ''
    );

  const gender =
    escapeReceptionHtml(
      patient.gender ||
      ''
    );

  const phone =
    escapeReceptionHtml(
      patient.phone ||
      ''
    );

  // -------------------------------------------------------
  // PRINT DOCUMENT
  // -------------------------------------------------------

  printWindow.document.write(`

    <!DOCTYPE html>

    <html>

      <head>

        <meta charset="UTF-8">

        <title>
          Patient Card - ${patientId}
        </title>

        <style>

          * {
            box-sizing: border-box;
          }

          body {

            margin: 0;

            padding: 20mm;

            font-family:
              Arial,
              Helvetica,
              sans-serif;

            background:
              #ffffff;

            color:
              #111111;

          }

          .patient-card {

            width:
              100%;

            max-width:
              650px;

            margin:
              0 auto;

            border:
              2px solid #111827;

            border-radius:
              10px;

            padding:
              28px;

            background:
              #ffffff;

          }

          .hospital-title {

            text-align:
              center;

            font-size:
              22px;

            font-weight:
              bold;

            margin-bottom:
              6px;

          }

          .card-title {

            text-align:
              center;

            font-size:
              16px;

            font-weight:
              bold;

            margin-bottom:
              20px;

          }

          .patient-number {

            text-align:
              center;

            font-size:
              26px;

            font-weight:
              bold;

            margin:
              15px 0 25px 0;

            letter-spacing:
              1px;

          }

          .divider {

            border-top:
              1px solid #999;

            margin:
              15px 0;

          }

          .detail {

            display:
              flex;

            justify-content:
              space-between;

            gap:
              20px;

            padding:
              10px 0;

            border-bottom:
              1px solid #dddddd;

          }

          .label {

            font-weight:
              bold;

          }

          .value {

            text-align:
              right;

          }

          .queue-status {

            margin-top:
              22px;

            padding:
              14px;

            border:
              1px solid #111827;

            border-radius:
              6px;

            text-align:
              center;

            font-weight:
              bold;

          }

          .footer {

            text-align:
              center;

            margin-top:
              25px;

            font-size:
              12px;

          }

          @media print {

            body {

              padding:
                0;

            }

            .patient-card {

              max-width:
                none;

              border:
                2px solid #111827;

            }

          }

        </style>

      </head>

      <body>

        <div class="patient-card">

          <div class="hospital-title">

            HOSPITAL MANAGEMENT SYSTEM

          </div>

          <div class="card-title">

            PATIENT IDENTIFICATION CARD

          </div>

          <div class="patient-number">

            ${patientId}

          </div>

          <div class="divider"></div>

          <div class="detail">

            <span class="label">
              Patient ID
            </span>

            <span class="value">
              ${patientId}
            </span>

          </div>

          <div class="detail">

            <span class="label">
              Full Name
            </span>

            <span class="value">
              ${fullName}
            </span>

          </div>

          <div class="detail">

            <span class="label">
              Date of Birth
            </span>

            <span class="value">
              ${dateOfBirth}
            </span>

          </div>

          <div class="detail">

            <span class="label">
              Gender
            </span>

            <span class="value">
              ${gender}
            </span>

          </div>

          <div class="detail">

            <span class="label">
              Phone
            </span>

            <span class="value">
              ${phone}
            </span>

          </div>

          <div class="queue-status">

            CURRENT STAGE:
            TRIAGE QUEUE

          </div>

          <div class="footer">

            Please present this card when
            attending hospital services.

          </div>

        </div>

        <script>

          window.onload =
            function () {

              window.print();

              setTimeout(
                function () {

                  window.close();

                },
                500
              );

            };

        <\/script>

      </body>

    </html>

  `);

  printWindow.document.close();

}

// =========================================================
// HTML ESCAPE FOR PRINT DOCUMENT
// =========================================================

function escapeReceptionHtml(
  value
) {

  return String(
    value ?? ''
  )

    .replace(
      /&/g,
      '&amp;'
    )

    .replace(
      /</g,
      '&lt;'
    )

    .replace(
      />/g,
      '&gt;'
    )

    .replace(
      /"/g,
      '&quot;'
    )

    .replace(
      /'/g,
      '&#039;'
    );

}

// =========================================================
// OPTIONAL COMPATIBILITY FUNCTION
//
// Old Reception HTML may still contain:
//
// onchange="updateConsultationFee()"
//
// This function intentionally does nothing because Reception
// no longer assigns clinics or collects consultation fees.
//
// Once the old clinic/fee HTML is removed, this function can
// also be removed.
// =========================================================

function updateConsultationFee() {

  return;

}

// =========================================================
// OPTIONAL COMPATIBILITY FUNCTION
//
// Old code may reference generatePatientId().
//
// Reception must NOT generate Patient IDs in JavaScript.
// PostgreSQL/Flask registration is responsible for the ID.
//
// This function is intentionally disabled.
// =========================================================

function generatePatientId() {

  console.warn(
    'Reception Patient IDs are generated by the database/backend.'
  );

  return null;

}


// =========================================================
// TRIAGE MODULE
// DATABASE-BACKED TRIAGE
//
// FLOW:
//
// Reception
//     ↓
// Triage Queue
//     ↓
// Triage Nurse
//     ├── Records vital signs
//     ├── Performs risk assessment
//     └── Assigns clinical department
//     ↓
// Doctor Queue
//
// IMPORTANT:
// Triage assigns the CLINICAL DEPARTMENT.
// Triage does NOT assign the doctor.
//
// PATIENT ID HANDLING:
//
// The Triage patient selector submits:
//     patient.patient_id
//
// Example:
//     P-1234
//
// The backend uses Patient.patient_id to locate the
// patient, then internally uses Patient.id for database
// relationships.
// =========================================================

// =========================================================
// CALCULATE BMI
// =========================================================

function calcBMI() {

  const weightElement =
    document.getElementById(
      'v-weight'
    );

  const heightElement =
    document.getElementById(
      'v-height'
    );

  const bmiElement =
    document.getElementById(
      'v-bmi'
    );

  if (
    !weightElement ||
    !heightElement ||
    !bmiElement
  ) {

    return;

  }

  const weight =
    parseFloat(
      weightElement.value
    );

  const height =
    parseFloat(
      heightElement.value
    ) / 100;

  if (
    weight > 0 &&
    height > 0
  ) {

    const bmi =
      weight /
      (
        height *
        height
      );

    bmiElement.value =
      bmi.toFixed(1);

  } else {

    bmiElement.value =
      '';

  }

}


// =========================================================
// LOAD TRIAGE DEPARTMENTS
//
// Loads clinical departments from the database.
//
// The database department ID is used as the option value.
// The department name is used as the visible text.
// =========================================================

async function loadTriageDepartments() {

  const select =
    document.getElementById(
      'v-assigned-clinic'
    );

  if (!select) {

    return;

  }

  try {

    const response =
      await fetch(
        '/api/departments/',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    if (!response.ok) {

      throw new Error(
        'Failed to load clinical departments.'
      );

    }

    const data =
      await response.json();

    // =====================================================
    // GET DEPARTMENT ARRAY
    // =====================================================

    const departments =
      Array.isArray(
        data.departments
      )
        ? data.departments
        : [];

    // =====================================================
    // CLEAR EXISTING OPTIONS
    // =====================================================

    select.innerHTML = '';

    // =====================================================
    // DEFAULT OPTION
    // =====================================================

    const defaultOption =
      document.createElement(
        'option'
      );

    defaultOption.value =
      '';

    defaultOption.textContent =
      'Select Assigned Clinic';

    select.appendChild(
      defaultOption
    );

    // =====================================================
    // NO DEPARTMENTS
    // =====================================================

    if (!departments.length) {

      const emptyOption =
        document.createElement(
          'option'
        );

      emptyOption.value =
        '';

      emptyOption.disabled =
        true;

      emptyOption.textContent =
        'No clinical departments configured';

      select.appendChild(
        emptyOption
      );

      return;

    }

    // =====================================================
    // BUILD DEPARTMENT OPTIONS
    // =====================================================

    departments.forEach(
      function (department) {

        if (!department) {

          return;

        }

        // -------------------------------------------------
        // DATABASE DEPARTMENT ID
        // -------------------------------------------------

        const departmentId =
          department.id;

        if (
          departmentId ===
            undefined ||
          departmentId ===
            null
        ) {

          return;

        }

        // -------------------------------------------------
        // DEPARTMENT NAME
        // -------------------------------------------------

        let departmentName =
          department.name;

        // -------------------------------------------------
        // SAFETY: HANDLE OBJECT NAME
        // -------------------------------------------------

        if (
          departmentName &&
          typeof departmentName ===
            'object'
        ) {

          departmentName =
            departmentName.name ||
            departmentName.label ||
            departmentName.title ||
            departmentName.value ||
            '';

        }

        // -------------------------------------------------
        // FINAL TEXT CONVERSION
        // -------------------------------------------------

        if (
          departmentName ===
            null ||
          departmentName ===
            undefined
        ) {

          departmentName =
            '';

        }

        departmentName =
          String(
            departmentName
          ).trim();

        if (!departmentName) {

          return;

        }

        // -------------------------------------------------
        // CREATE OPTION
        // -------------------------------------------------

        const option =
          document.createElement(
            'option'
          );

        option.value =
          String(
            departmentId
          );

        option.textContent =
          departmentName;

        select.appendChild(
          option
        );

      }
    );

    // =====================================================
    // DEBUG
    // =====================================================

    console.log(
      'TRIAGE DEPARTMENTS LOADED:',
      departments
    );

  } catch (error) {

    console.error(
      'TRIAGE DEPARTMENT LOAD FAILED:',
      error
    );

    select.innerHTML = '';

    const errorOption =
      document.createElement(
        'option'
      );

    errorOption.value =
      '';

    errorOption.textContent =
      'Unable to load clinical departments';

    select.appendChild(
      errorOption
    );

  }

}


// =========================================================
// LOAD TRIAGE PATIENT QUEUE
// =========================================================

async function loadTriagePatientQueue() {

  const role = await hmsWaitForAuthRole();
  if (!hmsRoleMayCall('/api/triage/queue')) {
    const unavailable = document.getElementById('triage-patient-select');
    if (unavailable) unavailable.innerHTML = '<option value="">Triage queue is not available for this account.</option>';
    return;
  }

  const select =
    document.getElementById(
      'triage-patient-select'
    );

  if (!select) {
    return;
  }

  select.innerHTML = `
    <option value="">
      Loading Triage Queue...
    </option>
  `;

  try {

    const response =
      await fetch(
        '/api/triage/queue',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Unable to load Triage Queue.'
      );

    }

    const patients =
      Array.isArray(data.patients)
        ? data.patients
        : [];

    select.innerHTML = `
      <option value="">
        -- Select Patient from Triage Queue --
      </option>
    `;

    patients.forEach(
      patient => {

        const option =
          document.createElement(
            'option'
          );

        // PostgreSQL patients.id
        option.value =
          String(
            patient.id
          );

        option.dataset.databasePatientId = String(patient.id);

        option.dataset.databasePatientId = String(patient.id);

        // User sees normal HMS Patient ID
        option.textContent =
          `${patient.patient_id} - ${
            patient.full_name || ''
          } (Triage Queue)`;

        select.appendChild(
          option
        );

      }
    );

    if (!patients.length) {

      const emptyOption =
        document.createElement(
          'option'
        );

      emptyOption.value = '';

      emptyOption.disabled = true;

      emptyOption.textContent =
        'No patients in Triage Queue';

      select.appendChild(
        emptyOption
      );

    }

  } catch (error) {

    console.error(
      'TRIAGE QUEUE LOAD ERROR:',
      error
    );

    select.innerHTML = `
      <option value="">
        Unable to load Triage Queue
      </option>
    `;

  }

}
// =========================================================
// CLEAR TRIAGE FORM
// =========================================================

function clearTriageForm() {

  const form =
    document.querySelector(
      '#reception-triage-assessment form, #mod-reception form[onsubmit*="saveTriage"]'
    );

  if (form) {

    form.reset();

  }

  const bmi =
    document.getElementById(
      'v-bmi'
    );

  if (bmi) {

    bmi.value =
      '';

  }

}


// =========================================================
// TRIAGE INITIALIZATION
//
// Loads the department list whenever the Triage module
// becomes available.
// =========================================================

async function initializeTriageModule() {

  await loadTriageDepartments();

  loadTriagePatientQueue();

}

// =========================================================
// TRIAGE MODULE CHANGE HANDLER
//
// Call this when opening the Triage module if needed.
// =========================================================

function prepareTriageModule() {

  loadTriageDepartments();

  loadTriagePatientQueue();

}



// =========================================================
// GENERIC INPUT SETTER
// =========================================================

function setInputValue(
  id,
  value
) {

  const element =
    document.getElementById(id);

  if (!element) return;

  element.value =
    value || '';

}



/* =========================================================
   HMS DATABASE-BACKED DOCTOR + RADIOLOGY PATCH
   =========================================================
   This combines the Doctor/Radiology workflow with:
   - Staff registration
   - Triage doctor assignment
   - Doctor queue
   - Doctor clinical records
   - Doctor referrals
   - Follow-up
   - Lab orders
   - Radiology orders/results
   - Radiology image upload
   ========================================================= */

// =========================================================
// STAFF REGISTRATION
// =========================================================

async function registerStaff(event) {

  event.preventDefault();

  const name =
    document.getElementById(
      'st-name'
    )?.value.trim();

  const role =
    document.getElementById(
      'st-role'
    )?.value.trim();

  const username =
    document.getElementById(
      'st-username'
    )?.value.trim();

  const password =
    document.getElementById(
      'st-password'
    )?.value;

  const phone =
    document.getElementById(
      'st-phone'
    )?.value.trim() || '';

  const email =
    document.getElementById(
      'st-email'
    )?.value.trim() || '';

  if (
    !name ||
    !role ||
    !username ||
    !password
  ) {

    alert(
      'Complete name, role, username and password.'
    );

    return;
  }

  try {

    const response =
      await fetch(
        '/api/staff/',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          credentials:
            'same-origin',

          body:
            JSON.stringify({
              name,
              role,
              username,
              password,
              phone,
              email
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Unable to register staff.'
      );

    }

    event.target.reset();

    if (
      typeof loadStaffFromDatabase ===
      'function'
    ) {

      await loadStaffFromDatabase();

    }

    alert(
      `Staff registered successfully.\n\n` +
      `Staff Number: ${data.staff.staff_id}\n` +
      `Username: ${data.staff.username}`
    );

  } catch (error) {

    console.error(
      'Staff registration error:',
      error
    );

    alert(
      error.message ||
      'Unable to connect to HMS server.'
    );

  }

}



// =========================================================
// DOCTOR QUEUE
// =========================================================

async function loadDoctorClinicPatients() {

  const select =
    document.getElementById(
      'doc-patient-select'
    );

  if (!select) {
    return;
  }

  select.innerHTML =
    '<option value="">Loading Department Queue...</option>';

  try {

    const response =
      await fetch(
        '/api/doctor/queue',
        {
          credentials:
            'same-origin',

          cache:
            'no-store'
        }
      );

    // =======================================================
    // READ RESPONSE SAFELY
    // =======================================================

    const contentType =
      response.headers.get(
        'content-type'
      ) || '';

    const responseText =
      await response.text();

    if (
      !contentType
        .toLowerCase()
        .includes('application/json')
    ) {

      console.error(
        'Doctor queue returned non-JSON response:',
        response.status,
        responseText
      );

      throw new Error(
        `Doctor Queue returned an invalid server response (HTTP ${response.status}).`
      );
    }

    let data;

    try {

      data =
        JSON.parse(
          responseText
        );

    } catch (parseError) {

      console.error(
        'Doctor queue JSON parse error:',
        parseError,
        responseText
      );

      throw new Error(
        'Doctor Queue returned invalid JSON.'
      );
    }

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Unable to load Doctor Queue.'
      );
    }

    // =======================================================
    // DATABASE DOCTOR QUEUE
    // =======================================================

    doctorQueuePatients =
      Array.isArray(
        data.patients
      )
        ? data.patients
        : [];

    select.innerHTML =
      '<option value="">-- Select Department Patient --</option>';

    doctorQueuePatients.forEach(
      patient => {

        const option =
          document.createElement(
            'option'
          );

        option.value =
          String(
            patient.id
          );

        option.textContent =
          `${patient.patient_id} — ${patient.full_name}`;

        select.appendChild(
          option
        );

      }
    );

    if (
      !doctorQueuePatients.length
    ) {

      const emptyOption =
        document.createElement(
          'option'
        );

      emptyOption.value =
        '';

      emptyOption.disabled =
        true;

      emptyOption.textContent =
        'No patients in your department queue.';

      select.appendChild(
        emptyOption
      );

    }

  } catch (error) {

    console.error(
      'Doctor queue error:',
      error
    );

    select.innerHTML =
      '<option value="">Unable to load department queue.</option>';

  }

}

// =========================================================
// DOCTOR QUEUE
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

async function loadDoctorClinicPatients(options = {}) {

    const select = document.getElementById(
        'doc-patient-select'
    );

    if (!select) {
        return;
    }

    // Preserve the currently selected patient if they
    // remain eligible for the doctor queue.
    const previousPatientId = select.value;

    select.innerHTML =
        '<option value="">Loading Department Queue...</option>';

    try {

        const response = await fetch(
            '/api/doctor/queue',
            {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        const contentType =
            response.headers.get('content-type') || '';

        const responseText = await response.text();

        if (
            !contentType.toLowerCase().includes(
                'application/json'
            )
        ) {

            console.error(
                'Doctor queue returned non-JSON response:',
                response.status,
                responseText
            );

            throw new Error(
                `Doctor Queue returned an invalid server response (HTTP ${response.status}).`
            );
        }

        let data;

        try {

            data = JSON.parse(responseText);

        } catch (parseError) {

            console.error(
                'Doctor queue JSON parse error:',
                parseError,
                responseText
            );

            throw new Error(
                'Doctor Queue returned invalid JSON.'
            );
        }

        if (!response.ok || !data.success) {

            throw new Error(
                data.error ||
                'Unable to load Doctor Queue.'
            );
        }

        // Keep the database response as the source of truth.
        doctorQueuePatients = Array.isArray(data.patients)
            ? data.patients
            : [];
        if (options.excludePatientId != null) {
            doctorQueuePatients = doctorQueuePatients.filter(
                patient => String(patient.id) !== String(options.excludePatientId)
            );
        }

        select.innerHTML =
            '<option value="">-- Select Department Patient --</option>';

        doctorQueuePatients.forEach(function (patient) {

            const option = document.createElement('option');

            option.value = String(patient.id);

            option.textContent =
                `${patient.patient_id} — ${patient.full_name}`;

            select.appendChild(option);

        });

        // Restore the selection only if the patient is
        // still present in the latest database queue.
        const patientStillInQueue = doctorQueuePatients.some(
            function (patient) {
                return String(patient.id) ===
                    String(previousPatientId);
            }
        );

        if (patientStillInQueue) {

            select.value = String(previousPatientId);

        } else {

            select.value = '';

            // Clear stale patient information when the
            // selected patient has left the queue.
            if (previousPatientId) {
                clearDoctorFields();
            }

        }

        if (!doctorQueuePatients.length) {

            const emptyOption = document.createElement(
                'option'
            );

            emptyOption.value = '';
            emptyOption.disabled = true;

            emptyOption.textContent =
                'No patients in your department queue.';

            select.appendChild(emptyOption);

        }

    } catch (error) {

        console.error(
            'Doctor queue error:',
            error
        );

        select.innerHTML =
            '<option value="">Unable to load department queue.</option>';

        throw error;

    }

}

// =========================================================
// DOCTOR PATIENT CHANGE
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

async function handleDoctorPatientChange() {

    const select = document.getElementById(
        'doc-patient-select'
    );

    const selectedValue = select
        ? select.value
        : '';

    if (!selectedValue) {

        clearDoctorFields();

        return;
    }

    const patientId = Number(selectedValue);

    if (!Number.isInteger(patientId) || patientId <= 0) {

        clearDoctorFields();

        return;
    }

    try {

        const response = await fetch(
            `/api/doctor/patient/${patientId}`,
            {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        const contentType =
            response.headers.get('content-type') || '';

        const responseText = await response.text();

        if (
            !contentType.toLowerCase().includes(
                'application/json'
            )
        ) {

            console.error(
                'Doctor patient returned non-JSON response:',
                response.status,
                responseText
            );

            throw new Error(
                `Unable to load patient information (HTTP ${response.status}).`
            );
        }

        let data;

        try {

            data = JSON.parse(responseText);

        } catch (parseError) {

            console.error(
                'Doctor patient JSON parse error:',
                parseError,
                responseText
            );

            throw new Error(
                'The server returned invalid patient data.'
            );
        }

        if (
            !response.ok ||
            !data.success ||
            !data.patient
        ) {

            throw new Error(
                data.error ||
                'Unable to load patient.'
            );
        }

        // Do not display information for a patient who is
        // no longer the selected patient.
        if (
            !select ||
            select.value !== String(patientId)
        ) {
            return;
        }

        await loadDoctorPatientData(data.patient);

    } catch (error) {

        console.error(
            'Doctor patient error:',
            error
        );

        clearDoctorFields();

        alert(
            error.message ||
            'Unable to load patient.'
        );

    }

}


// =========================================================
// LOAD DOCTOR PATIENT DATA
// DATABASE RESPONSE ONLY
// =========================================================

function renderDoctorClinicalProgress(patient) {
  const container = document.getElementById('doc-clinical-progress-content');
  if (!container) return;

  const clinicalValue =
    patient?.clinical ||
    patient?.clinical_record ||
    patient?.latest_clinical_record ||
    patient?.consultation ||
    {};

  const recordsSource =
    patient?.clinical_records ||
    patient?.clinical_history ||
    patient?.consultations ||
    patient?.clinicalHistory ||
    null;

  let records = [];
  if (Array.isArray(recordsSource)) {
    records = recordsSource;
  } else if (Array.isArray(clinicalValue)) {
    records = clinicalValue;
  } else if (clinicalValue && typeof clinicalValue === 'object' &&
             Object.keys(clinicalValue).length) {
    records = [clinicalValue];
  }

  if (!records.length) {
    container.innerHTML = `
      <strong>Clinical Progress</strong>
      <div style="margin-top:10px;color:#64748b;">
        No saved doctor history, examination, or diagnosis is available for this patient yet.
      </div>
    `;
    return;
  }

  const fields = [
    ['History of Present Illness', ['hpi', 'history_of_present_illness']],
    ['Past Medical / Surgical History', ['past_history', 'past_medical_history', 'past_surgical_history']],
    ['Systemic Examination', ['examination', 'exam', 'physical_examination']],
    ['Drug / Social / Family History', ['social_history', 'drug_history', 'family_history']],
    ['Provisional Diagnosis', ['provisional_diagnosis', 'prov_diag']],
    ['Differential Diagnosis', ['differential_diagnosis', 'diff_diag']],
    ['Final Diagnosis', ['final_diagnosis', 'diagnosis']],
    ['Review Date', ['review_date', 'followup_date']]
  ];

  container.innerHTML = `
    <strong>Clinical Progress & Consultation History</strong>
    <div style="margin-top:10px;display:grid;gap:12px;">
      ${records.map((record, index) => {
        const details = fields.map(([label, keys]) => {
          const value = keys.map(key => record?.[key]).find(value =>
            value !== undefined && value !== null && String(value).trim() !== ''
          );
          if (value === undefined) return '';
          return `
            <div style="margin-top:6px;overflow-wrap:anywhere;">
              <strong>${escapeHTML(label)}:</strong>
              <div style="white-space:pre-wrap;">${escapeHTML(value)}</div>
            </div>
          `;
        }).filter(Boolean).join('');

        const recordedAt = record?.created_at || record?.updated_at || record?.consultation_date;
        const clinician = record?.doctor_name || record?.doctor || record?.clinician_name || '';
        return `
          <article style="border:1px solid #cbd5e1;border-radius:6px;padding:12px;background:#fff;">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <strong>Consultation ${records.length - index}</strong>
              <small style="color:#64748b;">${recordedAt ? escapeHTML(new Date(recordedAt).toLocaleString()) : ''}</small>
            </div>
            ${clinician ? `<div style="margin-top:5px;"><strong>Doctor:</strong> ${escapeHTML(clinician)}</div>` : ''}
            ${details || '<div style="margin-top:8px;color:#64748b;">No clinical details were returned for this record.</div>'}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function extractNursingRecords(source) {
  if (!source || typeof source !== 'object') return [];

  const arrayKeys = [
    'nursing_records', 'nursingRecords', 'nursing_history',
    'nursingHistory', 'nursing_records_history', 'care_records',
    'careRecords', 'nursing'
  ];

  for (const key of arrayKeys) {
    if (Array.isArray(source[key])) return source[key];
    if (source[key] && typeof source[key] === 'object') return [source[key]];
  }

  const hasNursingFields = [
    'assessment', 'care_plan', 'interventions', 'medication_notes',
    'vital_signs', 'patient_response', 'nursing_notes', 'shift'
  ].some(key => source[key] !== undefined && source[key] !== null && source[key] !== '');

  return hasNursingFields ? [source] : [];
}

function renderDoctorNursingRecords(container, records) {
  if (!container) return;

  if (!records.length) {
    container.innerHTML = `
      <strong>Nursing Care Records</strong>
      <div style="margin-top:8px;color:#64748b;">
        No saved nursing-care details were returned for this patient.
        Any nursing report sent to the doctor appears below in Nursing Follow-up Reports.
      </div>
    `;
    return;
  }

  const fields = [
    ['Nursing Assessment', ['assessment']],
    ['Care Plan', ['care_plan', 'carePlan']],
    ['Interventions / Procedures', ['interventions', 'procedure', 'procedures']],
    ['Medication Administered', ['medication_notes', 'medication_administered', 'medicationNotes']],
    ['Vital Signs / Monitoring', ['vital_signs', 'monitoring', 'vitalSigns']],
    ['Patient Response', ['patient_response', 'response', 'patientResponse']],
    ['Shift', ['shift']],
    ['Nursing Notes / Progress', ['nursing_notes', 'notes', 'nursingNotes']]
  ];

  container.innerHTML = `
    <strong>Nursing Care Records</strong>
    <div style="margin-top:10px;display:grid;gap:10px;">
      ${records.map((record, index) => {
        const body = fields.map(([label, keys]) => {
          const value = keys.map(key => record?.[key]).find(value =>
            value !== undefined && value !== null && String(value).trim() !== ''
          );
          if (value === undefined) return '';
          return `
            <div style="margin-top:6px;overflow-wrap:anywhere;">
              <strong>${escapeHTML(label)}:</strong>
              <div style="white-space:pre-wrap;">${escapeHTML(value)}</div>
            </div>
          `;
        }).filter(Boolean).join('');

        const date = record?.created_at || record?.recorded_at || record?.updated_at;
        const nurse = record?.nurse_name || record?.staff_name || record?.nurse || '';
        return `
          <article style="border:1px solid #cbd5e1;border-radius:6px;padding:12px;background:#fff;">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <strong>Nursing Record ${records.length - index}</strong>
              <small style="color:#64748b;">${date ? escapeHTML(new Date(date).toLocaleString()) : ''}</small>
            </div>
            ${nurse ? `<div style="margin-top:5px;"><strong>Nurse:</strong> ${escapeHTML(nurse)}</div>` : ''}
            ${body || '<div style="margin-top:8px;color:#64748b;">No nursing details were included in this record.</div>'}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

async function loadDoctorNursingRecords(patientId, patientData = null) {
  const nursingTab = document.getElementById('doc-record-nursing');
  if (!nursingTab || !patientId) return;

  let container = document.getElementById('doctor-nursing-care-history');
  if (!container) {
    container = document.createElement('div');
    container.id = 'doctor-nursing-care-history';
    container.style.cssText = 'margin:0 0 15px 0;min-width:0;max-width:100%;';

    const reportsContainer = document.getElementById('doctor-followup-reports');
    if (reportsContainer && reportsContainer.parentElement === nursingTab) {
      nursingTab.insertBefore(container, reportsContainer);
    } else {
      nursingTab.prepend(container);
    }
  }

  container.innerHTML = '<div style="color:#64748b;">Loading nursing care records...</div>';

  let records = extractNursingRecords(patientData || {});

  if (!records.length) {
    try {
      const response = await fetch('/api/nursing/inpatient', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });

      const payload = await response.json().catch(() => []);
      if (response.ok) {
        const patients = Array.isArray(payload)
          ? payload
          : (Array.isArray(payload?.patients) ? payload.patients : []);

        const patientRow = patients.find(row => {
          const ids = [
            row?.patient_id, row?.id, row?.database_id,
            row?.patient_db_id, row?.patient?.id, row?.patient?.patient_id
          ].filter(value => value !== undefined && value !== null);
          return ids.some(value => String(value) === String(patientId));
        });

        if (patientRow) {
          records = extractNursingRecords(patientRow);
          if (!records.length && patientRow.latest_nursing_record) {
            records = [patientRow.latest_nursing_record];
          }
          if (!records.length && patientRow.latest_nursing) {
            records = [patientRow.latest_nursing];
          }
        }
      }
    } catch (error) {
      console.warn('Unable to load inpatient nursing history:', error);
    }
  }

  renderDoctorNursingRecords(container, records);
}

async function loadDoctorPatientDetailsForPanels(patientId) {
  if (!patientId) return;

  try {
    const response = await fetch(`/api/doctor/patient/${encodeURIComponent(patientId)}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.patient) return;

    renderDoctorClinicalProgress(data.patient);
    await loadDoctorNursingRecords(patientId, data.patient);
  } catch (error) {
    console.error('DOCTOR PATIENT HISTORY REFRESH ERROR:', error);
  }
}

async function loadDoctorPatientData(patient) {

  if (!patient) {
    return;
  }
  
  // =======================================================
  // NEW DOCTOR CONSULTATION
  //
  // Never load the previous ClinicalRecord into the
  // editable consultation form.
  //
  // Historical records remain in PostgreSQL and are
  // displayed separately as patient history/results.
  // =======================================================

  clearDoctorFields();

  const clinical =
    patient.clinical || {};

  const triage =
    patient.triage || {};

  // Keep saved consultation history separate from editable form fields.
  renderDoctorClinicalProgress(patient);

  // Show the selected patient's saved nursing care alongside reports sent by nurses.
  loadDoctorNursingRecords(patient.id || patient.patient_id, patient).catch(error => {
    console.warn('DOCTOR NURSING HISTORY LOAD WARNING:', error);
  });

  // =======================================================
  // ALL TRIAGE INFORMATION
  // =======================================================

  const vitals =
    document.getElementById(
      'doc-vitals-summary'
    );

  if (vitals) {

    vitals.innerHTML = `

      <div style="
        display:grid;
        grid-template-columns:
          repeat(auto-fit,minmax(180px,1fr));
        gap:8px;
      ">

        <div>
          <strong>Priority:</strong>
          ${escapeHTML(
            triage.priority ||
            patient.current_priority ||
            '—'
          )}
        </div>

        <div>
          <strong>BMI:</strong>
          ${escapeHTML(triage.bmi ?? '—')}
        </div>

        <div>
          <strong>Blood Pressure:</strong>
          ${escapeHTML(
            triage.blood_pressure || '—'
          )}
        </div>

        <div>
          <strong>Temperature:</strong>
          ${escapeHTML(
            triage.temperature ?? '—'
          )} °C
        </div>

        <div>
          <strong>Pulse:</strong>
          ${escapeHTML(
            triage.pulse ?? '—'
          )} bpm
        </div>

        <div>
          <strong>Respiratory Rate:</strong>
          ${escapeHTML(
            triage.respiratory_rate ?? '—'
          )} /min
        </div>

        <div>
          <strong>SpO₂:</strong>
          ${escapeHTML(
            triage.spo2 ?? '—'
          )} %
        </div>

        <div>
          <strong>Blood Sugar:</strong>
          ${escapeHTML(
            triage.blood_sugar ?? '—'
          )}
        </div>

        <div>
          <strong>Pain Score:</strong>
          ${escapeHTML(
            triage.pain_score ?? '—'
          )}
        </div>

        <div>
          <strong>Pregnancy Status:</strong>
          ${escapeHTML(
            triage.pregnancy_status || '—'
          )}
        </div>

        <div>
          <strong>GCS:</strong>
          ${escapeHTML(
            triage.gcs ?? '—'
          )}
        </div>

        <div>
          <strong>Fall Risk:</strong>
          ${escapeHTML(
            triage.fall_risk || '—'
          )}
        </div>

      </div>

      <div style="
        margin-top:12px;
        padding-top:10px;
        border-top:1px solid #cbd5e1;
      ">

        <strong>Chief Complaint:</strong><br>
        ${escapeHTML(
          triage.chief_complaint ||
          'Not recorded'
        )}

        <br><br>

        <strong>Allergies:</strong><br>
        ${escapeHTML(
          triage.allergies ||
          'None recorded'
        )}

      </div>
    `;
  }

  // =======================================================
  // LABORATORY RESULTS
  // DATABASE RESPONSE ONLY
  // =======================================================

  let laboratoryContent =
    document.getElementById(
      'doc-laboratory-content'
    );

  // -------------------------------------------------------
  // CREATE LABORATORY PANEL IF HTML DOES NOT CONTAIN IT
  // -------------------------------------------------------

  if (!laboratoryContent) {

    const radiologyPanel =
      document.getElementById(
        'doc-radiology-results'
      );

    if (radiologyPanel) {

      const laboratoryPanel =
        document.createElement('div');

      laboratoryPanel.id =
        'doc-laboratory-results';

      laboratoryPanel.style.cssText =
        `
          background:#f8fafc;
          border:1px solid #cbd5e1;
          padding:15px;
          margin-bottom:15px;
          border-radius:6px;
        `;

      laboratoryPanel.innerHTML =
        `
          <strong>
            Laboratory Results
          </strong>

          <div
            id="doc-laboratory-content"
            style="margin-top:10px;"
          >
            <em>
              Loading laboratory results...
            </em>
          </div>
        `;

      radiologyPanel.insertAdjacentElement(
        'afterend',
        laboratoryPanel
      );

      laboratoryContent =
        document.getElementById(
          'doc-laboratory-content'
        );
    }
  }

  // -------------------------------------------------------
  // RENDER DATABASE LABORATORY DATA
  // -------------------------------------------------------

  if (laboratoryContent) {

    const laboratory =
      Array.isArray(patient.laboratory)
        ? patient.laboratory
        : [];

    if (!laboratory.length) {

      laboratoryContent.innerHTML =
        '<em>No laboratory requests or results for this patient.</em>';

    } else {

      laboratoryContent.innerHTML =
        laboratory.map(function (lab) {

          const results =
            Array.isArray(lab.results)
              ? lab.results
              : [];

          return `
            <div style="
              border:1px solid #cbd5e1;
              border-radius:6px;
              padding:10px;
              margin-top:10px;
            ">

              <div>
                <strong>Test:</strong>
                ${escapeHTML(
                  lab.test_name || '—'
                )}
              </div>

              <div>
                <strong>Request ID:</strong>
                ${escapeHTML(
                  lab.request_id || '—'
                )}
              </div>

              <div>
                <strong>Sample Type:</strong>
                ${escapeHTML(
                  lab.sample_type || '—'
                )}
              </div>

              <div>
                <strong>Barcode:</strong>
                ${escapeHTML(
                  lab.barcode || '—'
                )}
              </div>

              <div>
                <strong>Status:</strong>
                ${escapeHTML(
                  lab.status || '—'
                )}
              </div>

              ${
                results.length
                  ? results.map(function (result) {

                      return `
                        <div style="
                          margin-top:10px;
                          padding:10px;
                          background:#ffffff;
                          border-top:1px solid #e2e8f0;
                        ">

                          <strong>Result:</strong><br>

                          ${escapeHTML(
                            result.results || '—'
                          )}

                          <br><br>

                          <strong>Verification:</strong>
                          ${escapeHTML(
                            result.verification_status || '—'
                          )}

                          <br>

                          <strong>Laboratory Technician:</strong>
                          ${escapeHTML(
                            result.technician || '—'
                          )}

                          <br>

                          <strong>Recorded:</strong>
                          ${
                            result.created_at
                              ? new Date(
                                  result.created_at
                                ).toLocaleString()
                              : '—'
                          }

                        </div>
                      `;

                    }).join('')
                  : `
                    <div style="
                      margin-top:10px;
                      color:#64748b;
                    ">
                      No laboratory result available yet.
                    </div>
                  `
              }

            </div>
          `;

        }).join('');
    }
  }

  // =======================================================
  // LOAD RADIOLOGY RESULTS DIRECTLY FROM DATABASE API
  // =======================================================

  await loadDoctorRadiologyResults(
    patient.id
  );

}

// =========================================================
// DOCTOR RADIOLOGY RESULTS
// =========================================================

async function loadDoctorRadiologyResults(patientId) {

    const container =
        document.getElementById('doc-radiology-results');

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div>Loading radiology results...</div>';

    try {

        const response = await fetch(
            `/api/doctor/patient/${patientId}/radiology-results`,
            {
                credentials: 'include'
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error ||
                'Unable to load radiology results.'
            );
        }

        if (!data.radiology || !data.radiology.length) {

            container.innerHTML =
                '<div>No radiology requests for this patient.</div>';

            return;
        }

        let html = '';

        data.radiology.forEach(item => {

            html += `
                <div class="doctor-radiology-card">

                    <div>
                        Radiology Test:<br>
                        <strong>${item.examination || 'Radiology'}</strong>
                    </div>

                    <div>
                        Status:
                        <strong>${item.status}</strong>
                    </div>
            `;

            if (!item.results || !item.results.length) {

                html += `
                    <div>
                        No result has been uploaded yet.
                    </div>
                `;

            } else {

                item.results.forEach(result => {

                    html += `
                        <div class="doctor-radiology-result">

                            <div>
                                <strong>Findings:</strong>
                            </div>

                            <div>
                                ${result.findings || ''}
                            </div>

                            ${
                                result.reported_by
                                ? `
                                    <div>
                                        Reported by:
                                        ${result.reported_by}
                                    </div>
                                  `
                                : ''
                            }

                            ${
                                result.image_url
                                ? `
                                    <div
                                        class="doctor-radiology-image-wrapper"
                                        style="
                                            overflow:auto;
                                            max-width:100%;
                                            max-height:600px;
                                            text-align:center;
                                        "
                                    >
                                        <img
                                            src="${result.image_url}"
                                            class="doctor-radiology-image"
                                            style="
                                                max-width:100%;
                                                height:auto;
                                                transform:scale(1);
                                                transform-origin:center;
                                                transition:transform 0.2s ease;
                                            "
                                            alt="Radiology scan"
                                        >
                                    </div>

                                    <div
                                        style="
                                            display:flex;
                                            gap:8px;
                                            margin-top:10px;
                                        "
                                    >
                                        <button
                                            type="button"
                                            onclick="zoomDoctorRadiologyImage(this, 0.2)"
                                        >
                                            +
                                        </button>

                                        <button
                                            type="button"
                                            onclick="zoomDoctorRadiologyImage(this, -0.2)"
                                        >
                                            −
                                        </button>

                                        <button
                                            type="button"
                                            onclick="resetDoctorRadiologyImage(this)"
                                        >
                                            Fit
                                        </button>

                                        <button
                                            type="button"
                                            onclick="fullscreenDoctorRadiologyImage(this)"
                                        >
                                            Full Screen
                                        </button>
                                    </div>
                                  `
                                : ''
                            }

                        </div>
                    `;

                });

            }

            html += `</div>`;
        });

        container.innerHTML = html;

    } catch (error) {

        console.error(
            'Radiology results error:',
            error
        );

        container.innerHTML = `
            <div>
                ${error.message}
            </div>
        `;
    }
}


// =========================================================
// SAVE DOCTOR CONSULTATION
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================
async function saveDoctorConsultation(event) {
    event.preventDefault();

    const patientSelect = document.getElementById(
        'doc-patient-select'
    );

    const selectedValue = patientSelect ? patientSelect.value : '';

    const patientId = Number(
        selectedValue
    );

    if (
        !selectedValue ||
        !Number.isInteger(patientId) ||
        patientId <= 0
    ) {
        alert(
            'Select an assigned patient.'
        );
        return;
    }

    // =====================================================
    // REFERRAL
    // =====================================================
    const referralDestination = (
        document.getElementById(
            'd-referral-destination'
        )?.value || ''
    ).trim().toLowerCase();

    const referralNotes = document.getElementById(
        'd-referral'
    )?.value.trim() || null;

    // =====================================================
    // MEDICATIONS
    // =====================================================
    const medications = getDoctorMedications();

    // =====================================================
    // LABORATORY / RADIOLOGY
    // =====================================================
    const labOrder = document.getElementById(
        'd-lab-order'
    )?.value.trim() || null;

    const radiologyOrder = document.getElementById(
        'd-rad-order'
    )?.value.trim() || null;

    // =====================================================
    // REVIEW DATE
    // =====================================================
    const reviewDate = document.getElementById(
        'd-followup-date'
    )?.value || null;

    // =====================================================
    // BUILD DATABASE PAYLOAD
    // =====================================================
    const payload = {
        patient_id: patientId,
        hpi: document.getElementById(
            'd-hpi'
        )?.value.trim() || null,
        past_history: document.getElementById(
            'd-past-hx'
        )?.value.trim() || null,
        examination: document.getElementById(
            'd-exam'
        )?.value.trim() || null,
        social_history: document.getElementById(
            'd-social'
        )?.value.trim() || null,
        provisional_diagnosis: document.getElementById(
            'd-prov-diag'
        )?.value.trim() || null,
        differential_diagnosis: document.getElementById(
            'd-diff-diag'
        )?.value.trim() || null,
        final_diagnosis: document.getElementById(
            'd-final-diag'
        )?.value.trim() || null,
        lab_order: labOrder,
        radiology_order: radiologyOrder,
        medications: medications,
        review_date: reviewDate,
        referral_destination: referralDestination,
        referral_notes: referralNotes
    };

    // =====================================================
    // PREVENT DUPLICATE SUBMISSIONS
    // =====================================================
    const submitButton = event.submitter || null;

    if (submitButton) {
        submitButton.disabled = true;
    }

    try {
        // =================================================
        // SAVE CONSULTATION
        // =================================================
        const response = await fetch(
            '/api/doctor/consultation',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify(
                    payload
                )
            }
        );

        const responseText = await response.text();

        let data;

        try {
            data = JSON.parse(
                responseText
            );
        } catch (parseError) {
            console.error(
                'Consultation response was not valid JSON:',
                response.status,
                responseText
            );

            throw new Error(
                `The server returned an invalid response (HTTP ${response.status}).`
            );
        }

        if (!response.ok || !data.success) {
            throw new Error(
                data.error ||
                data.message ||
                'Unable to save consultation.'
            );
        }

        // =================================================
        // DETERMINE WHETHER THE PATIENT SHOULD LEAVE
        // =================================================
        const patientPhase = String(
            data.patient_phase || ''
        ).trim().toLowerCase();

        const normalizedDestination = String(
            referralDestination || ''
        ).trim().toLowerCase();

        const hasMedication = data.medication_prescribed === true ||
            (
                Array.isArray(medications) &&
                medications.length > 0
            );

        const hasReferral = Boolean(
            data.referral
        ) || [
            'nurse',
            'nursing',
            'theatre'
        ].includes(
            normalizedDestination
        );

        const hasLabOrder = Boolean(
            data.lab_request
        ) || Boolean(
            labOrder
        );

        const hasRadiologyOrder = Boolean(
            data.radiology_request
        ) || Boolean(
            radiologyOrder
        );

        const isReferralPhase = [
            'nurse referral queue',
            'nursing queue',
            'theatre referral queue'
        ].includes(
            patientPhase
        );

        const isPharmacyPhase = patientPhase === 'pharmacy queue';

        const isInvestigationPhase = [
            'laboratory queue',
            'lab queue',
            'radiology queue'
        ].includes(
            patientPhase
        );

        // A persisted investigation request confirms the patient was
        // sent out of the Doctor queue to the receiving department.
        const investigationDispatched = (
            hasLabOrder &&
            Boolean(data.lab_request)
        ) || (
            hasRadiologyOrder &&
            Boolean(data.radiology_request)
        );

        const patientDispatched = data.patient_released === true ||
            isReferralPhase ||
            isPharmacyPhase ||
            isInvestigationPhase ||
            hasReferral ||
            hasMedication ||
            investigationDispatched;

        // Remove forwarded patients from the dropdown before any queue
        // refresh so the selection bar updates as soon as saving succeeds.
        if (patientDispatched && patientSelect) {
            Array.from(patientSelect.options)
                .find(option => option.value === String(patientId))
                ?.remove();
            patientSelect.value = '';
            doctorQueuePatients = Array.isArray(doctorQueuePatients)
                ? doctorQueuePatients.filter(patient => String(patient.id) !== String(patientId))
                : [];
        }

        // =================================================
        // CLEAR CONSULTATION INPUTS AFTER SUCCESSFUL SAVE
        // =================================================
        clearDoctorFields();

        // =================================================
        // REFRESH DATABASE QUEUE
        // =================================================
        try {
            await loadDoctorClinicPatients(
                patientDispatched ? { excludePatientId: patientId } : {}
            );
        } catch (refreshError) {
            console.error(
                'Doctor queue refresh failed after saving:',
                refreshError
            );
        }

        // =================================================
        // PATIENT HAS LEFT THE DOCTOR'S WORKING SCREEN
        // =================================================
        if (patientDispatched) {
            if (patientSelect) {
                Array.from(patientSelect.options)
                    .find(option => option.value === String(patientId))
                    ?.remove();
                patientSelect.value = '';
            }

            /*
             * Clear both the editable form and the visible
             * patient information panels immediately.
             */
            clearDoctorFields();

            if (typeof loadDoctorPatientData === 'function') {
                await loadDoctorPatientData(
                    null
                );
            } else {
                clearDoctorFields();
            }

            // Refresh follow-up reports if available.
            if (typeof loadDoctorNursingReviewReports === 'function') {
                try {
                    await loadDoctorNursingReviewReports();
                } catch (reviewError) {
                    console.warn(
                        'Doctor review report refresh warning:',
                        reviewError
                    );
                }
            }

            let message = data.message || 'Consultation saved successfully.';

            if (hasLabOrder || hasRadiologyOrder) {
                message += '\n\nInvestigation request(s) saved successfully.';
            }

            if (hasMedication) {
                message += '\n\nPrescription saved successfully.';
            }

            if (hasReferral) {
                message += '\n\nReferral saved successfully.';
            }

            alert(
                message
            );

            return;
        }

        // =================================================
        // PATIENT REMAINS IN DOCTOR QUEUE
        // =================================================
        const patientStillAvailable = Array.isArray(
            doctorQueuePatients
        ) && doctorQueuePatients.some(
            function (patient) {
                return String(
                    patient.id
                ) === String(
                    patientId
                );
            }
        );

        if (patientStillAvailable && patientSelect) {
            patientSelect.value = String(
                patientId
            );

            try {
                const patientResponse = await fetch(
                    `/api/doctor/patient/${patientId}`,
                    {
                        method: 'GET',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        headers: {
                            'Accept': 'application/json'
                        }
                    }
                );

                const patientData = await patientResponse.json();

                if (
                    patientResponse.ok &&
                    patientData.success &&
                    patientData.patient &&
                    patientSelect.value === String(patientId)
                ) {
                    await loadDoctorPatientData(
                        patientData.patient
                    );
                }
            } catch (patientRefreshError) {
                console.warn(
                    'Doctor patient information refresh warning:',
                    patientRefreshError
                );
            }
        } else {
            /*
             * If the patient is no longer in the refreshed
             * database queue, do not leave their information
             * displayed on the screen.
             */
            if (patientSelect) {
                patientSelect.value = '';
            }

            clearDoctorFields();

            if (typeof loadDoctorPatientData === 'function') {
                await loadDoctorPatientData(
                    null
                );
            }
        }

        // =================================================
        // FOLLOW-UP REPORTS
        // =================================================
        if (typeof loadDoctorNursingReviewReports === 'function') {
            try {
                await loadDoctorNursingReviewReports();
            } catch (reviewError) {
                console.warn(
                    'Doctor review report refresh warning:',
                    reviewError
                );
            }
        }

        // =================================================
        // SUCCESS MESSAGE
        // =================================================
        let successMessage = data.message || 'Doctor consultation saved successfully.';

        if (hasLabOrder || hasRadiologyOrder) {
            successMessage += '\n\nInvestigation request(s) saved successfully.';
        }

        if (hasMedication) {
            successMessage += '\n\nPrescription saved successfully.';
        }

        if (hasReferral) {
            successMessage += '\n\nReferral saved successfully.';
        }

        alert(
            successMessage
        );

    } catch (error) {
        console.error(
            'SAVE DOCTOR CONSULTATION ERROR:',
            error
        );

        alert(
            error.message ||
            'Unable to save doctor consultation.'
        );

    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
}

// =========================================================
// CLEAR DOCTOR CONSULTATION FIELDS
// PRESERVE THE CURRENT PATIENT SELECTION
// DOES NOT DELETE DATABASE RECORDS
// =========================================================

function clearDoctorFields() {

    // -----------------------------------------------------
    // Clear editable consultation fields only
    // -----------------------------------------------------

    const ids = [
        'd-hpi',
        'd-past-hx',
        'd-exam',
        'd-social',
        'd-prov-diag',
        'd-diff-diag',
        'd-final-diag',
        'd-lab-order',
        'd-rad-order',
        'd-followup-date',
        'd-referral',
        'd-referral-destination'
    ];

    ids.forEach(
        function (
            id
        ) {

            const element = document.getElementById(
                id
            );

            if (
                !element
            ) {
                return;
            }

            if (
                element.tagName === 'SELECT'
            ) {
                element.selectedIndex = 0;
            } else {
                element.value = '';
            }
        }
    );

    // -----------------------------------------------------
    // Clear visible patient information panels.
    // These will be repopulated when a patient is loaded.
    // -----------------------------------------------------

    const displayIds = [
        'doc-vitals-summary',
        'doc-laboratory-content',
        'doc-radiology-results',
        'doc-clinical-progress-content',
        'doctor-nursing-care-history'
    ];

    displayIds.forEach(
        function (
            id
        ) {

            const element = document.getElementById(
                id
            );

            if (
                element
            ) {
                element.replaceChildren();
            }
        }
    );

    // -----------------------------------------------------
    // Clear medication entry fields if they exist.
    // -----------------------------------------------------

    const medicationIds = [
        'd-rx-drug',
        'd-rx-freq',
        'd-rx-dur'
    ];

    medicationIds.forEach(
        function (
            id
        ) {

            const element = document.getElementById(
                id
            );

            if (
                element
            ) {
                element.value = '';
            }
        }
    );

    // -----------------------------------------------------
    // Clear medication search suggestions only.
    // -----------------------------------------------------

    const medicationResults = document.getElementById(
        'd-rx-drug-results'
    );

    if (
        medicationResults
    ) {
        medicationResults.replaceChildren();
    }

    // IMPORTANT:
    // Do not reset doc-patient-select here.
    // Patient selection is managed by the queue and
    // patient-selection handler.
}

// =========================================================
// ADD DOCTOR MEDICATION
// SEARCHABLE DATABASE INVENTORY
// =========================================================

function addDoctorMedication() {

  const container =
    document.getElementById(
      'doctor-medication-list'
    );

  if (!container) {
    return;
  }

  const medication =
    document.createElement('div');

  medication.className =
    'doctor-medication-item';

  medication.style.marginTop =
    '20px';

  medication.style.paddingTop =
    '15px';

  medication.style.borderTop =
    '1px solid #e2e8f0';

  medication.innerHTML = `

    <div class="form-group">

      <label>Medication</label>

      <input
        type="text"
        class="d-rx-drug-search"
        placeholder="Search medication..."
        autocomplete="off"
      >

      <input
        type="hidden"
        class="d-rx-drug"
        value=""
      >

      <div
        class="d-rx-drug-results"
        style="
          display:none;
          position:relative;
          background:#fff;
          border:1px solid #cbd5e1;
          border-radius:4px;
          max-height:180px;
          overflow-y:auto;
          z-index:1000;
        "
      ></div>

    </div>

    <div class="grid-2">

      <div class="form-group">

        <label>Route & Frequency</label>

        <input
          type="text"
          class="d-rx-freq"
          placeholder="e.g. Oral / TDS"
        >

      </div>

      <div class="form-group">

        <label>Duration & Instructions</label>

        <input
          type="text"
          class="d-rx-dur"
          placeholder="e.g. 5 Days after food"
        >

      </div>

    </div>

  `;

  container.appendChild(
    medication
  );

  setupDoctorMedicationSearch(
    medication
  );

}

// =========================================================
// DOCTOR MEDICATION SEARCH
// DATABASE INVENTORY IS THE SOURCE OF TRUTH
// EVENT-DELEGATED SO RECREATED MEDICATION ROWS WORK
// =========================================================

function setupDoctorMedicationSearch(row) {

  /*
   * The medication row is recreated by clearDoctorFields()
   * and can also be created by addDoctorMedication().
   *
   * Therefore the search listener must NOT depend on
   * one particular row remaining in the DOM.
   *
   * Bind the document listener only once.
   */

  if (
    window.__doctorMedicationSearchBound === true
  ) {
    return;
  }

  window.__doctorMedicationSearchBound =
    true;

  // =======================================================
  // LOAD CURRENT INVENTORY DIRECTLY FROM DATABASE
  // =======================================================

  async function getDoctorMedicationInventory() {

    try {

      const response =
        await fetch(
          '/api/pharmacy/inventory',
          {
            method: 'GET',

            credentials:
              'same-origin',

            cache:
              'no-store',

            headers: {
              'Accept':
                'application/json'
            }
          }
        );

      if (!response.ok) {

        throw new Error(
          `Unable to load inventory (HTTP ${response.status}).`
        );

      }

      const data =
        await response.json();

      if (
        !data ||
        data.success !== true
      ) {

        throw new Error(
          data?.error ||
          data?.message ||
          'Unable to load inventory.'
        );

      }

      const inventory =
        Array.isArray(data.items)
          ? data.items
          : [];

      /*
       * Keep state synchronized with
       * the actual PostgreSQL inventory.
       */

      state.inventory =
        inventory;

      return inventory;

    } catch (error) {

      console.error(
        'DOCTOR MEDICATION INVENTORY LOAD ERROR:',
        error
      );

      state.inventory = [];

      throw error;

    }

  }

  // =======================================================
  // RENDER MEDICATION SEARCH RESULTS
  // =======================================================

  function renderDoctorMedicationResults(
    row,
    inventory,
    searchTerm
  ) {

    if (!row) {
      return;
    }

    const searchInput =
      row.querySelector(
        '.d-rx-drug-search'
      );

    const hiddenInput =
      row.querySelector(
        '.d-rx-drug'
      );

    const results =
      row.querySelector(
        '.d-rx-drug-results'
      );

    if (
      !searchInput ||
      !hiddenInput ||
      !results
    ) {
      return;
    }

    const term =
      String(
        searchTerm || ''
      )
        .trim()
        .toLowerCase();

    /*
     * IMPORTANT:
     *
     * Do NOT require category === "Drug Stock"
     * before searching.
     *
     * We search the actual medication name/code
     * returned by PostgreSQL.
     */

    const matches =
      inventory.filter(
        item => {

          const name =
            String(
              item.item_name ||
              item.name ||
              ''
            )
              .trim()
              .toLowerCase();

          const code =
            String(
              item.item_code ||
              item.code ||
              ''
            )
              .trim()
              .toLowerCase();

          const category =
            String(
              item.category ||
              ''
            )
              .trim()
              .toLowerCase();

          const drugType =
            String(
              item.drug_type ||
              ''
            )
              .trim()
              .toLowerCase();

          /*
           * Only exclude obvious non-drug
           * inventory categories.
           *
           * Do not depend on one exact
           * capitalization/value.
           */

          const isDrug =
            category === 'drug stock' ||
            category === 'drug' ||
            category === 'drugs' ||
            category === 'medicine' ||
            category === 'medication' ||
            drugType !== '';

          if (
            !isDrug
          ) {
            return false;
          }

          return (
            !term ||
            name.includes(term) ||
            code.includes(term)
          );

        }
      );

    results.innerHTML = '';

    // =====================================================
    // NO RESULTS
    // =====================================================

    if (!matches.length) {

      results.innerHTML = `
        <div
          style="
            padding:10px;
            color:#64748b;
          "
        >
          No matching medication found.
        </div>
      `;

      results.style.display =
        'block';

      return;

    }

    // =====================================================
    // RESULTS
    // =====================================================

    matches.forEach(
      item => {

        const name =
          String(
            item.item_name ||
            item.name ||
            ''
          ).trim();

        const code =
          String(
            item.item_code ||
            item.code ||
            ''
          ).trim();

        const option =
          document.createElement(
            'div'
          );

        option.textContent =
          code
            ? `${code} - ${name}`
            : name;

        option.style.padding =
          '10px';

        option.style.cursor =
          'pointer';

        option.style.background =
          '#ffffff';

        option.style.borderBottom =
          '1px solid #e2e8f0';

        option.dataset.inventoryId =
          String(item.id);

        // ---------------------------------------------------
        // SELECT MEDICATION
        // ---------------------------------------------------

        option.addEventListener(
          'mousedown',
          function(event) {

            event.preventDefault();

            searchInput.value =
              name;

            /*
             * Store the actual PostgreSQL
             * InventoryItem.id.
             */

            hiddenInput.value =
              String(item.id);

            hiddenInput.dataset.drugName =
              name;

            hiddenInput.dataset.itemCode =
              code;

            results.style.display =
              'none';

          }
        );

        results.appendChild(
          option
        );

      }
    );

    results.style.display =
      'block';

  }

  // =======================================================
  // DOCUMENT-DELEGATED INPUT HANDLER
  // =======================================================

  document.addEventListener(
    'input',
    async function(event) {

      const searchInput =
        event.target.closest(
          '.d-rx-drug-search'
        );

      if (!searchInput) {
        return;
      }

      const row =
        searchInput.closest(
          '.doctor-medication-item'
        );

      if (!row) {
        return;
      }

      const hiddenInput =
        row.querySelector(
          '.d-rx-drug'
        );

      if (hiddenInput) {

        hiddenInput.value =
          '';

        hiddenInput.dataset.drugName =
          '';

        hiddenInput.dataset.itemCode =
          '';

      }

      /*
       * Get the CURRENT inventory from
       * PostgreSQL every time the user searches.
       */

      try {

        const inventory =
          await getDoctorMedicationInventory();

        renderDoctorMedicationResults(
          row,
          inventory,
          searchInput.value
        );

      } catch (error) {

        const results =
          row.querySelector(
            '.d-rx-drug-results'
          );

        if (results) {

          results.innerHTML = `
            <div
              style="
                padding:10px;
                color:#dc2626;
              "
            >
              Unable to load medications.
            </div>
          `;

          results.style.display =
            'block';

        }

      }

    }
  );

  // =======================================================
  // DOCUMENT-DELEGATED FOCUS HANDLER
  // =======================================================

  document.addEventListener(
    'focusin',
    async function(event) {

      const searchInput =
        event.target.closest(
          '.d-rx-drug-search'
        );

      if (!searchInput) {
        return;
      }

      const row =
        searchInput.closest(
          '.doctor-medication-item'
        );

      if (!row) {
        return;
      }

      try {

        const inventory =
          await getDoctorMedicationInventory();

        /*
         * Show the current database drugs
         * immediately when the field receives focus.
         */

        renderDoctorMedicationResults(
          row,
          inventory,
          searchInput.value
        );

      } catch (error) {

        console.error(
          'Doctor medication focus load error:',
          error
        );

      }

    }
  );

  // =======================================================
  // CLOSE RESULTS WHEN CLICKING OUTSIDE
  // =======================================================

  document.addEventListener(
    'click',
    function(event) {

      document
        .querySelectorAll(
          '.d-rx-drug-results'
        )
        .forEach(
          results => {

            const row =
              results.closest(
                '.doctor-medication-item'
              );

            if (!row) {
              return;
            }

            const searchInput =
              row.querySelector(
                '.d-rx-drug-search'
              );

            if (
              searchInput &&
              !searchInput.contains(
                event.target
              ) &&
              !results.contains(
                event.target
              )
            ) {

              results.style.display =
                'none';

            }

          }
        );

    }
  );

}

// =========================================================
// GET DOCTOR MEDICATIONS
// MATCHES ACTUAL prescriptions TABLE
// =========================================================

function getDoctorMedications() {

  const medicationList =
    document.getElementById(
      'doctor-medication-list'
    );

  if (!medicationList) {
    return [];
  }

  const rows =
    medicationList.querySelectorAll(
      '.doctor-medication-item'
    );

  const medications = [];

  rows.forEach(row => {

    const drugInput =
      row.querySelector(
        '.d-rx-drug'
      );

    const drugId =
      drugInput?.value.trim() || '';

    const drugName =
      drugInput?.dataset.drugName ||
      row.querySelector(
        '.d-rx-drug-search'
      )?.value.trim() ||
      '';

    const frequency =
      row.querySelector(
        '.d-rx-freq'
      )?.value.trim() || '';

    const duration =
      row.querySelector(
        '.d-rx-dur'
      )?.value.trim() || '';

    if (
      !drugId ||
      !drugName
    ) {
      return;
    }

    medications.push({

      inventory_item_id:
        Number(drugId),

      drug_name:
        drugName,

      frequency:
        frequency,

      duration:
        duration

    });

  });

  return medications;

}



// =========================================================
// CREATE DOCTOR REVIEW REPORT CARD
// =========================================================

function createDoctorNursingReviewReportCard(report) {

  const reportId = Number(report.id);
  const patientId = Number(report.patient_id);

  const patientName =
    report.patient_name || 'Unknown Patient';

  const patientCode =
    report.patient_code || '—';

  const nursingReport =
    report.report || 'No report text supplied.';

  const createdAt =
    report.created_at
      ? new Date(report.created_at).toLocaleString()
      : '—';

  return `
    <div
      style="
        margin-top:10px;
        padding:14px;
        background:#fff;
        border:1px solid #f59e0b;
        border-radius:7px;
        box-sizing:border-box;
        min-width:0;
        max-width:100%;
      "
    >

      <div>
        <strong>
          ${escapeHTML(patientName)}
        </strong>

        <br>

        <small>
          Patient ID: ${escapeHTML(patientCode)}
        </small>
      </div>

      ${report.prior_doctor_instructions ? `
      <div style="margin-top:10px;padding:10px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:5px;white-space:pre-wrap;overflow-wrap:anywhere;">
        <strong>Previous Doctor Instructions</strong>
        <div style="margin-top:6px;">${escapeHTML(report.prior_doctor_instructions)}</div>
      </div>` : ''}

      <div
        style="
          margin-top:10px;
          padding:10px;
          background:#f8fafc;
          border-radius:5px;
        "
      >
        <strong>Nurse's Report</strong>

        <div
          style="
            margin-top:6px;
            white-space:pre-wrap;
            overflow-wrap:anywhere;
          "
        >
          ${escapeHTML(nursingReport)}
        </div>

        <small style="display:block;margin-top:8px;">
          Submitted: ${escapeHTML(createdAt)}
        </small>
      </div>

      <div style="margin-top:10px;padding:10px;background:#f8fafc;border-radius:5px;white-space:pre-wrap;overflow-wrap:anywhere;">
        <strong>Doctor's Response</strong>
        <div style="margin-top:6px;">${escapeHTML(report.doctor_response || 'Awaiting doctor response.')}</div>
      </div>

      <div style="margin-top:12px;">
        <div id="doctor-review-date-wrap-${reportId}">
          <label for="doctor-review-date-${reportId}" style="display:block;font-weight:bold;margin-bottom:5px;">Next Review Date (required to keep patient)</label>
          <input type="date" id="doctor-review-date-${reportId}" value="${escapeHTML(report.review_date || '')}" style="width:100%;max-width:100%;box-sizing:border-box;padding:9px;">
        </div>

        <label
          for="doctor-review-ack-${reportId}"
          style="display:block;font-weight:bold;margin-bottom:5px;"
        >
          Doctor's Instructions or Discharge Authorization
        </label>

        <textarea
          id="doctor-review-ack-${reportId}"
          rows="3"
          style="
            width:100%;
            max-width:100%;
            min-width:0;
            box-sizing:border-box;
            resize:vertical;
          "
          placeholder="Enter nursing instructions or the discharge authorization..."
        ></textarea>

      </div>

      <div
        style="
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          margin-top:12px;
        "
      >

        <button
          type="button"
          class="btn btn-primary"
          onclick="
            acknowledgeDoctorNursingReview(
              ${reportId},
              ${patientId},
              'authorize_release'
            )
          "
        >
          Authorize Discharge
        </button>

        <button
          type="button"
          class="btn btn-secondary"
          onclick="
            acknowledgeDoctorNursingReview(
              ${reportId},
              ${patientId},
              'instructions'
            )
          "
        >
          Send Instructions & Keep Patient
        </button>

      </div>

    </div>
  `;
}

// =========================================================
// ACKNOWLEDGE NURSING REVIEW REPORT
// =========================================================

async function acknowledgeDoctorNursingReview(
  reportId,
  patientId,
  decision
) {

  if (!reportId || !patientId) {
    alert('The review report or patient ID is missing.');
    return;
  }

  if (
    decision !== 'authorize_release' &&
    decision !== 'instructions'
  ) {
    alert('Select a valid doctor decision.');
    return;
  }

  const instructionField = document.getElementById(
    `doctor-review-ack-${reportId}`
  );
  const dateField = document.getElementById(`doctor-review-date-${reportId}`);
  const reviewDate = dateField?.value || '';

  if (decision === 'instructions' && !reviewDate) {
    alert('Enter the next review date to keep the patient under nursing care.');
    dateField?.focus();
    return;
  }

  const acknowledgement =
    instructionField?.value.trim() || '';

  if (!acknowledgement) {
    alert(
      decision === 'authorize_release'
        ? "Enter the doctor's discharge authorization."
        : 'Enter the instructions the nurse must follow.'
    );

    instructionField?.focus();
    return;
  }

  const confirmation =
    decision === 'authorize_release'
      ? 'Authorize this patient for discharge?'
      : 'Send instructions to nursing and keep the patient under care?';

  if (!confirm(confirmation)) {
    return;
  }

  try {

    const response = await fetch(
      `/api/nursing/review-reports/${encodeURIComponent(reportId)}/acknowledge`,
      {
        method: 'POST',

        credentials: 'same-origin',

        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },

        body: JSON.stringify({
          acknowledgement: acknowledgement,
          decision: decision,
          review_date: decision === 'instructions' ? reviewDate : null
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(
        data.error ||
        data.message ||
        "Unable to save the doctor's review."
      );
    }

    alert(
      data.message ||
      'Doctor review saved successfully.'
    );

    await loadDoctorNursingReviewReports();
    if (typeof window.refreshDoctorRoundsPatient === 'function') {
      window.refreshDoctorRoundsPatient();
    }

  } catch (error) {

    console.error(
      'DOCTOR NURSING REVIEW ERROR:',
      error
    );

    alert(
      error.message ||
      "Unable to save the doctor's review."
    );
  }
}

// =========================================================
// RADIOLOGY RESULT SAVE
// =========================================================

async function saveRadiologyResult(
  event
) {

  event.preventDefault();

  const requestId =
    document.getElementById(
      'rad-request-select'
    )?.value;

  const findings =
    document.getElementById(
      'rad-findings'
    )?.value.trim();

  const image =
    document.getElementById(
      'rad-image'
    )?.files?.[0];

  if (!requestId) {

    alert(
      'Select a radiology request.'
    );

    return;

  }

  if (!findings) {

    alert(
      'Enter radiology findings.'
    );

    return;

  }

  const formData =
    new FormData();

  formData.append(
    'request_id',
    requestId
  );

  formData.append(
    'findings',
    findings
  );

  if (image) {

    formData.append(
      'image',
      image
    );

  }

  try {

    const response =
      await fetch(
        '/api/radiology/result',
        {
          method: 'POST',

          credentials:
            'same-origin',

          body:
            formData
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Unable to save radiology result.'
      );

    }

    alert(
      'Radiology result saved and returned to Doctor.'
    );

    event.target.reset();

    if (
      typeof loadRadiologyQueue ===
      'function'
    ) {

      await loadRadiologyQueue();

    }

  } catch (error) {

    console.error(
      'Radiology result error:',
      error
    );

    alert(
      error.message ||
      'Unable to save radiology result.'
    );

  }

}

// =========================================================
// RADIOLOGY QUEUE
// =========================================================

async function loadRadiologyQueue() {

  const select =
    document.getElementById(
      'rad-request-select'
    );

  const orderPanel =
    document.getElementById(
      'rad-doctor-orders'
    );

  if (!select) {
    return;
  }

  select.innerHTML =
    '<option value="">Loading radiology queue...</option>';

  if (orderPanel) {
    orderPanel.innerHTML = `
      <strong>Doctor's Radiology Order</strong>
      <span>Select a pending examination request.</span>
    `;
  }

  try {

    const response =
      await fetch(
        '/api/radiology/queue',
        {
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {
      throw new Error(
        data.error ||
        'Unable to load radiology queue.'
      );
    }

    select.innerHTML =
      '<option value="">-- Select Radiology Request --</option>';

    data.requests.forEach(item => {

      const option =
        document.createElement('option');

      // Database ID of this radiology request
      option.value =
        String(item.id);

      // Patient ID belonging to this request
      option.dataset.patientId =
        String(item.patient_id);

      // Actual radiology request ID
      option.dataset.requestId =
        item.request_id || '';

      // Store the doctor's examination/order
      option.dataset.examination =
        item.examination || '';

      // ONLY request ID + patient appear in the selection bar
      option.textContent =
        `${item.request_id} — ${
          item.patient ||
          'Patient ID ' + item.patient_id
        }`;

      select.appendChild(option);

    });

    // Show the doctor's order BELOW the selection bar
    select.onchange = function () {

      const selectedOption =
        select.options[
          select.selectedIndex
        ];

      if (
        !selectedOption ||
        !selectedOption.value
      ) {

        if (orderPanel) {
          orderPanel.innerHTML = `
            <strong>Doctor's Radiology Order</strong>
            <span>Select a pending examination request.</span>
          `;
        }

        return;
      }

      const examination =
        selectedOption.dataset.examination || '';

      if (orderPanel) {
        orderPanel.innerHTML = `
          <strong>Doctor's Radiology Order</strong>
          <span>${escapeHTML(examination)}</span>
        `;
      }

    };

  } catch (error) {

    console.error(
      'Radiology queue error:',
      error
    );

    select.innerHTML =
      `<option value="">${escapeHTML(
        error.message
      )}</option>`;

    if (orderPanel) {
      orderPanel.innerHTML = `
        <strong>Doctor's Radiology Order</strong>
        <span>Unable to load the examination request.</span>
      `;
    }
  }
}

// =========================================================
// PHARMACY
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

let pharmacyQueue = [];
let pharmacyInventory = [];

// =========================================================
// LOAD PHARMACY QUEUE
// =========================================================
// =========================================================
// LOAD PHARMACY PATIENTS
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

async function loadPharmacyQueue() {

  const select =
    document.getElementById(
      'pharm-patient-select'
    );

  if (!select) {
    return;
  }

  try {

    const response =
      await fetch(
        '/api/pharmacy/queue',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Unable to load pharmacy patients.'
      );

    }

    pharmacyQueue =
      Array.isArray(data.patients)
        ? data.patients
        : [];

    select.innerHTML = `
      <option value="">
        Select Patient
      </option>
    `;

    pharmacyQueue.forEach(
      patient => {

        const option =
          document.createElement(
            'option'
          );

        option.value =
          String(patient.patient_id);

        option.textContent =
          `${patient.hospital_patient_id} - ${patient.full_name}`;

        select.appendChild(option);

      }
    );

    if (!pharmacyQueue.length) {

      select.innerHTML = `
        <option value="">
          No patients in prescription queue
        </option>
      `;

    }

  }

  catch (error) {

    console.error(
      'PHARMACY QUEUE ERROR:',
      error
    );

    select.innerHTML = `
      <option value="">
        Unable to load pharmacy patients
      </option>
    `;

  }

}

// =========================================================
// LOAD SELECTED PATIENT PRESCRIPTIONS
// =========================================================

async function loadPharmRx() {

  const select =
    document.getElementById(
      'pharm-patient-select'
    );

  const container =
    document.getElementById(
      'pharm-rx-details'
    );

  const prescriptionInput =
    document.getElementById(
      'pharm-prescription-id'
    );

  if (!select || !container) {
    return;
  }

  const patientId =
    select.value;

  if (!patientId) {

    container.innerHTML = `
      <em>
        Select a patient to load ordered prescriptions.
      </em>
    `;

    if (prescriptionInput) {
      prescriptionInput.value = '';
    }

    return;
  }

  container.innerHTML =
    '<em>Loading prescriptions...</em>';

  try {

    const response =
      await fetch(
        `/api/pharmacy/patient/${encodeURIComponent(patientId)}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    const contentType =
  response.headers.get('content-type') || '';

let data = {};

if (
  contentType.includes('application/json')
) {

  data =
    await response.json();

} else {

  const text =
    await response.text();

  console.error(
    'PHARMACY PRESCRIPTION SERVER RESPONSE:',
    text
  );

  throw new Error(
    `Pharmacy prescription request failed (${response.status}). ` +
    `Server returned HTML instead of JSON. ` +
    `Check the Flask terminal for the traceback.`
  );

}

if (
  !response.ok ||
  !data.success
) {

  throw new Error(
    data.error ||
    data.message ||
    'Unable to load prescriptions.'
  );

}

    const prescriptions =
      Array.isArray(data.prescriptions)
        ? data.prescriptions
        : [];

    if (!prescriptions.length) {

      container.innerHTML = `
        <em>
          No active prescriptions for this patient.
        </em>
      `;

      if (prescriptionInput) {
        prescriptionInput.value = '';
      }

      return;
    }

    // Automatically select the first active prescription.
    if (prescriptionInput) {

      prescriptionInput.value =
        prescriptions[0].id;

    }

    container.innerHTML = `

      <strong>
        Doctor's Prescription
      </strong>

      <div style="margin-top:10px;">

        ${prescriptions.map(
          prescription => `

            <div
              style="
                background:white;
                border:1px solid #e2e8f0;
                border-radius:6px;
                padding:10px;
                margin-bottom:8px;
              "
            >

              <strong>
                ${escapeHTML(
                  prescription.drug_name || ''
                )}
              </strong>

              <div>
                Frequency:
                ${escapeHTML(
                  prescription.frequency || '—'
                )}
              </div>

              <div>
                Duration:
                ${escapeHTML(
                  prescription.duration || '—'
                )}
              </div>

            </div>

          `
        ).join('')}

      </div>

    `;

  }

  catch (error) {

    console.error(
      'PHARMACY PRESCRIPTION ERROR:',
      error
    );

    container.innerHTML = `
      <div style="color:#b91c1c;">
        Unable to load prescription.
        ${escapeHTML(error.message || '')}
      </div>
    `;

  }

}

// =========================================================
// LOAD PHARMACY INVENTORY
// =========================================================

async function loadPharmacyInventory() {

  try {

    const response =
      await fetch(
        '/api/pharmacy/inventory',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Unable to load pharmacy inventory.'
      );

    }

    pharmacyInventory =
      Array.isArray(data.items)
        ? data.items
        : [];
      

    populatePharmacyInventorySelects();

  }

  catch (error) {

    console.error(
      'PHARMACY INVENTORY ERROR:',
      error
    );

  }

}

// =========================================================
// PHARMACY INVENTORY SEARCH
// PATIENT + DEPARTMENT
// DATABASE INVENTORY IS THE SOURCE OF TRUTH
// =========================================================

function populatePharmacyInventorySelects() {

  setupPharmacyInventorySearch(
    'p-item-search',
    'p-item-select',
    'p-item-results',
    'p-unit-select'
  );

  setupPharmacyInventorySearch(
    'pharm-department-item-search',
    'pharm-department-item',
    'pharm-department-item-results',
    'pharm-department-unit'
  );

  const unitSelect = document.getElementById('p-unit-select');
  const quantityInput = document.getElementById('p-qty');
  if (unitSelect && unitSelect.dataset.costPreviewReady !== 'true') {
    unitSelect.dataset.costPreviewReady = 'true';
    unitSelect.addEventListener('change', updatePharmacyDispenseCostPreview);
  }
  if (quantityInput && quantityInput.dataset.costPreviewReady !== 'true') {
    quantityInput.dataset.costPreviewReady = 'true';
    quantityInput.addEventListener('input', updatePharmacyDispenseCostPreview);
  }

}

// =========================================================
// SEARCHABLE INVENTORY FIELD
// =========================================================

function setupPharmacyInventorySearch(
  searchId,
  hiddenId,
  resultsId,
  unitSelectId
) {

  const searchInput =
    document.getElementById(
      searchId
    );

  const hiddenInput =
    document.getElementById(
      hiddenId
    );

  const results =
    document.getElementById(
      resultsId
    );

  if (
    !searchInput ||
    !hiddenInput ||
    !results
  ) {
    return;
  }

  // Prevent duplicate listeners
  if (
    searchInput.dataset.searchReady ===
    'true'
  ) {
    return;
  }

  searchInput.dataset.searchReady =
    'true';

  function renderResults() {

    const term =
      searchInput.value
        .trim()
        .toLowerCase();

    const matches =
      pharmacyInventory.filter(
        item => {

          const name =
            String(
              item.item_name ||
              ''
            ).toLowerCase();

          const code =
            String(
              item.item_code ||
              ''
            ).toLowerCase();

          const category =
            String(
              item.category ||
              ''
            ).toLowerCase();

          return (
            !term ||
            name.includes(term) ||
            code.includes(term) ||
            category.includes(term)
          );

        }
      );

    results.innerHTML = '';

    if (!matches.length) {

      results.innerHTML = `
        <div
          style="
            padding:10px;
            color:#64748b;
          "
        >
          No matching inventory item found.
        </div>
      `;

      results.style.display =
        'block';

      return;
    }

    matches.forEach(item => {

      const option =
        document.createElement('div');

      option.textContent =
        `${item.item_code || ''} - ${item.item_name || ''}`;

      option.style.padding =
        '9px 10px';

      option.style.cursor =
        'pointer';

      option.style.borderBottom =
        '1px solid #e2e8f0';

      option.addEventListener(
        'mousedown',
        function(event) {

          event.preventDefault();

          hiddenInput.value =
            String(item.id);

          searchInput.value =
            `${item.item_code || ''} - ${item.item_name || ''}`;

          results.style.display =
            'none';

          updatePharmacyUnitOptionsFromItem(
            item,
            unitSelectId
          );
          if (hiddenId === 'p-item-select') updatePharmacyDispenseCostPreview();

        }
      );

      results.appendChild(
        option
      );

    });

    results.style.display =
      'block';

  }

  searchInput.addEventListener(
    'input',
    function() {

      hiddenInput.value = '';

      if (hiddenId === 'p-item-select') updatePharmacyDispenseCostPreview();

      renderResults();

    }
  );

  searchInput.addEventListener(
    'focus',
    function() {

      renderResults();

    }
  );

  document.addEventListener(
    'click',
    function(event) {

      if (
        !searchInput.contains(
          event.target
        ) &&
        !results.contains(
          event.target
        )
      ) {

        results.style.display =
          'none';

      }

    }
  );

}


// =========================================================
// UPDATE DISPENSING UNITS
// =========================================================

function updatePharmacyUnitOptions(
  selectId,
  unitSelectId
) {

  const hiddenInput =
    document.getElementById(
      selectId
    );

  const unitSelect =
    document.getElementById(
      unitSelectId
    );

  if (
    !hiddenInput ||
    !unitSelect
  ) {
    return;
  }

  const item =
    pharmacyInventory.find(
      inventoryItem =>
        String(inventoryItem.id) ===
        String(hiddenInput.value)
    );

  if (!item) {

    unitSelect.innerHTML = `
      <option value="unit">
        Units
      </option>
    `;

    return;

  }

  updatePharmacyUnitOptionsFromItem(
    item,
    unitSelectId
  );

}

// =========================================================
// UPDATE DISPENSING UNITS FROM DATABASE VALUATION METHOD
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

function updatePharmacyUnitOptionsFromItem(
  item,
  unitSelectId
) {

  const unitSelect =
    document.getElementById(
      unitSelectId
    );

  if (!unitSelect) {
    return;
  }

  // -------------------------------------------------------
  // READ VALUATION METHOD DIRECTLY FROM DATABASE ITEM
  // -------------------------------------------------------

  const valuationMethod =
    String(
      item.valuation_method || ''
    )
    .trim()
    .toLowerCase();

  // -------------------------------------------------------
  // STRIPS / BOXES
  //
  // Used for tablet medication.
  // -------------------------------------------------------

  if (
    valuationMethod ===
    'strips / boxes'
  ) {

    unitSelect.innerHTML = `

      <option value="strip">
        Strips
      </option>

      <option value="box">
        Boxes
      </option>

    `;

    return;
  }

  // -------------------------------------------------------
  // BOTTLES
  // -------------------------------------------------------

  if (
    valuationMethod ===
    'bottles'
  ) {

    unitSelect.innerHTML = `

      <option value="bottle">
        Bottles
      </option>

    `;

    return;
  }

  // -------------------------------------------------------
  // TUBES
  // -------------------------------------------------------

  if (
    valuationMethod ===
    'tubes'
  ) {

    unitSelect.innerHTML = `

      <option value="tube">
        Tubes
      </option>

    `;

    return;
  }

  // -------------------------------------------------------
  // PIECES
  // -------------------------------------------------------

  if (
    valuationMethod ===
    'pieces'
  ) {

    unitSelect.innerHTML = `

      <option value="piece">
        Pieces
      </option>

    `;

    return;
  }

  // -------------------------------------------------------
  // BOXES
  // -------------------------------------------------------

  if (
    valuationMethod ===
    'boxes'
  ) {

    unitSelect.innerHTML = `

      <option value="box">
        Boxes
      </option>

    `;

    return;
  }

  // -------------------------------------------------------
  // PACKS
  // -------------------------------------------------------

  if (
    valuationMethod ===
    'packs'
  ) {

    unitSelect.innerHTML = `

      <option value="pack">
        Packs
      </option>

    `;

    return;
  }

  // -------------------------------------------------------
  // UNITS
  // -------------------------------------------------------

  if (
    valuationMethod ===
    'units'
  ) {

    unitSelect.innerHTML = `

      <option value="unit">
        Units
      </option>

    `;

    return;
  }

  // -------------------------------------------------------
  // INVALID / MISSING VALUATION METHOD
  // -------------------------------------------------------

  unitSelect.innerHTML = `

    <option value="">
      No valid dispensing unit
    </option>

  `;

}

// =========================================================
// DISPENSE PRESCRIPTION MEDICATION
// DATABASE DOES THE STOCK REDUCTION
// =========================================================

async function dispenseMeds(event) {

  event.preventDefault();

  const patientId =
    document.getElementById(
      'pharm-patient-select'
    )?.value;

  const prescriptionId =
    document.getElementById(
      'pharm-prescription-id'
    )?.value;

  const inventoryItemId =
    document.getElementById(
      'p-item-select'
    )?.value;

  const quantity =
    parseInt(
      document.getElementById(
        'p-qty'
      )?.value,
      10
    );

  const unit =
    document.getElementById(
      'p-unit-select'
    )?.value;

  const expiryDate =
    document.getElementById(
      'p-exp'
    )?.value || null;

  if (!patientId) {

    alert(
      'Select a patient.'
    );

    return;

  }

  if (!prescriptionId) {

    alert(
      'No active prescription is selected.'
    );

    return;

  }

  if (!inventoryItemId) {

    alert(
      'Select an inventory item.'
    );

    return;

  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {

    alert(
      'Enter a valid quantity.'
    );

    return;

  }

  try {

    const response =
      await fetch(
        '/api/pharmacy/dispense',
        {
          method: 'POST',

          credentials: 'same-origin',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify({

              patient_id:
                Number(patientId),

              prescription_id:
                Number(prescriptionId),

              inventory_item_id:
                Number(inventoryItemId),

              quantity,

              unit,

              expiry_date:
                expiryDate

            })

        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Medication dispensing failed.'
      );

    }

    const billedAmount = Number(data.pharmacy_bill_amount || 0);
    alert(`${data.message || 'Medication dispensed successfully.'}${billedAmount > 0 ? `\nAdded to patient billing: ${billedAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '\nNo pharmacy charge was added because this item has no cost saved.'}`);

    event.target.reset();

    await loadPharmacyQueue();

    await loadPharmacyInventory();

    const patientSelect =
      document.getElementById(
        'pharm-patient-select'
      );

    if (patientSelect) {
      patientSelect.value = '';
    }

    const details =
      document.getElementById(
        'pharm-rx-details'
      );

    if (details) {

      details.innerHTML = `
        <em>
          Select a patient to load ordered prescriptions.
        </em>
      `;

    }

  }

  catch (error) {

    console.error(
      'PHARMACY DISPENSING ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to dispense medication.'
    );

  }

}

// =========================================================
// LOAD DEPARTMENTS
// =========================================================

async function loadPharmacyDepartments() {

  const select =
    document.getElementById(
      'pharm-department-select'
    );

  if (!select) {
    return;
  }

  try {

    const response =
      await fetch(
        '/api/departments/',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    const data =
      await response.json();

    const departments =
      Array.isArray(data.departments)
        ? data.departments
        : [];

    select.innerHTML = `
      <option value="">
        Select Department
      </option>
    `;

    departments.forEach(
      department => {

        const option =
          document.createElement(
            'option'
          );

        option.value =
          String(department.id);

        option.textContent =
          department.name;

        select.appendChild(
          option
        );

      }
    );

  }

  catch (error) {

    console.error(
      'PHARMACY DEPARTMENT ERROR:',
      error
    );

  }

}

// =========================================================
// DISPENSE MATERIAL TO DEPARTMENT
// DATABASE DOES THE STOCK REDUCTION
// =========================================================

async function dispenseDepartmentMaterial(
  event
) {

  event.preventDefault();

  const departmentId =
    document.getElementById(
      'pharm-department-select'
    )?.value;

  const inventoryItemId =
    document.getElementById(
      'pharm-department-item'
    )?.value;

  const quantity =
    parseInt(
      document.getElementById(
        'pharm-department-qty'
      )?.value,
      10
    );

  const unit =
    document.getElementById(
      'pharm-department-unit'
    )?.value;

  if (!departmentId) {

    alert(
      'Select a department.'
    );

    return;

  }

  if (!inventoryItemId) {

    alert(
      'Select a material.'
    );

    return;

  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {

    alert(
      'Enter a valid quantity.'
    );

    return;

  }

  try {

    const response =
      await fetch(
        '/api/pharmacy/department-dispense',
        {
          method: 'POST',

          credentials: 'same-origin',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify({

              department_id:
                Number(departmentId),

              inventory_item_id:
                Number(inventoryItemId),

              quantity,

              unit

            })

        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Department dispensing failed.'
      );

    }

    alert(
      data.message ||
      'Material dispensed to department successfully.'
    );

    event.target.reset();

    await loadPharmacyInventory();

  }

  catch (error) {

    console.error(
      'DEPARTMENT DISPENSING ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to dispense material.'
    );

  }

}

// =========================================================
// PHARMACY MODULE INITIALIZATION
// =========================================================

async function initializePharmacyModule() {

  await Promise.all([
    loadPharmacyQueue(),
    loadPharmacyInventory(),
    loadPharmacyDepartments()
  ]);

}



// =========================================================
// NURSING
// DOCTOR NOTES + REFERRALS + FOLLOW-UP
// =========================================================

async function loadNurseClinicalInformation() {

  const select =
    document.getElementById('nurse-patient-select');

  const container =
    document.getElementById('nurse-doctor-information');

  if (!container) return;

  const referralId = select?.value;

  if (!referralId) {
    container.innerHTML =
      `<em>Select a patient to view doctor's instructions.</em>`;
    return;
  }

  try {

    const response =
      await fetch('/api/nursing/referrals');

    if (!response.ok) {
      throw new Error('Failed to load nursing referrals');
    }

    const referrals = await response.json();

    const referral =
      referrals.find(
        item =>
          String(item.id) === String(referralId)
      );

    if (!referral) {
      container.innerHTML =
        `<em>This nursing referral is no longer pending.</em>`;
      return;
    }

    container.innerHTML = `

      <div class="clinical-doctor-information">

        <h4>
          Doctor's Instructions
        </h4>

        <strong>
          Referral
        </strong>

        <div
          style="
            margin:8px 0;
            padding:10px;
            border:1px solid #ddd;
            border-radius:6px;
          "
        >

          <strong>
            Nursing Ward
          </strong>

          <br>

          <span>
            Status:
            ${escapeHTML(
              referral.status || 'PENDING'
            )}
          </span>

          <br>

          <strong>
            Referral Notes:
          </strong>

          <div>
            ${
              referral.notes
                ? escapeHTML(referral.notes)
                : '<em>No referral notes provided.</em>'
            }
          </div>

          ${
            referral.created_at
              ? `
                <small>
                  ${new Date(
                    referral.created_at
                  ).toLocaleString()}
                </small>
              `
              : ''
          }

        </div>

      </div>

    `;

  } catch (error) {

    console.error(
      'Failed to load nursing referral:',
      error
    );

    container.innerHTML =
      `<em>Unable to load doctor's referral.</em>`;
  }
}


// =========================================================
// THEATRE - LOAD PATIENTS
// DATABASE-BACKED
//
// Only patients who have a PENDING theatre referral AND
// do NOT already have a saved surgical record should appear.
//
// A patient must disappear from the theatre selection
// immediately after the surgical record is successfully saved.
// =========================================================

async function loadTheatrePatients() {

  const select =
    document.getElementById(
      'ot-patient-select'
    );

  if (!select) {
    return;
  }

  try {

    // -----------------------------------------------------
    // LOAD CURRENT THEATRE REFERRALS
    // -----------------------------------------------------

    const referralsResponse =
      await fetch(
        '/api/surgery/referrals',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const referralsData =
      await referralsResponse
        .json()
        .catch(() => []);

    if (!referralsResponse.ok) {

      throw new Error(
        referralsData?.error ||
        'Failed to load theatre referrals.'
      );

    }

    const referrals =
      Array.isArray(referralsData)
        ? referralsData
        : (
            Array.isArray(
              referralsData?.referrals
            )
              ? referralsData.referrals
              : []
          );

    // -----------------------------------------------------
    // BUILD THE SELECTOR FROM THE CURRENT DATABASE QUEUE
    // -----------------------------------------------------

    select.innerHTML = `
      <option value="">
        -- Select Referred Patient --
      </option>
    `;

    referrals.forEach(
      referral => {

        const option =
          document.createElement(
            'option'
          );

        /*
         * The selector stores the REFERRAL ID.
         * saveSurgicalRecord() later resolves this referral
         * to the real patient database ID.
         */

        option.value =
          String(
            referral.id
          );

        option.dataset.patientId = String(referral.patient_id || '');

        option.textContent =
          `${referral.patient_code || referral.patient_id || ''} - ${referral.patient_name || ''}`;

        select.appendChild(
          option
        );

      }
    );

    // -----------------------------------------------------
    // CLEAR THE CLINICAL INFORMATION WHEN NOTHING
    // IS AVAILABLE
    // -----------------------------------------------------

    if (!referrals.length) {

      select.innerHTML = `
        <option value="">
          No patients awaiting theatre
        </option>
      `;

      const container =
        document.getElementById(
          'theatre-doctor-notes'
        );

      if (container) {

        container.innerHTML =
          `<em>
            No patients are currently awaiting Operating Theatre care.
          </em>`;

      }

      return;
    }

    // -----------------------------------------------------
    // LOAD INFORMATION FOR CURRENTLY SELECTED PATIENT
    // -----------------------------------------------------

    if (
      typeof loadTheatreClinicalInformation ===
      'function'
    ) {

      await loadTheatreClinicalInformation();

    }

  } catch (error) {

    console.error(
      'Failed to load theatre referrals:',
      error
    );

    select.innerHTML = `
      <option value="">
        Unable to load referrals
      </option>
    `;

  }

}

// =========================================================
// OPERATING THEATRE
// SAVE COMPLETE THEATRE RECORD
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

async function saveSurgicalRecord(event) {

  event.preventDefault();

  try {

    // -----------------------------------------------------
    // GET THEATRE FORM ELEMENTS
    // -----------------------------------------------------

    const patientSelect =
      document.getElementById(
        'ot-patient-select'
      );

    const procedureInput =
      document.getElementById(
        'ot-procedure'
      );

    const consentSelect =
      document.getElementById(
        'ot-consent'
      );

    const surgeonSelect =
      document.getElementById(
        'ot-surgeon'
      );

    const anaesthetistInput =
      document.getElementById(
        'ot-anaesthetist'
      );

    const anaesthesiaTypeSelect =
      document.getElementById(
        'ot-anaesthesia-type'
      );

    const notesInput =
      document.getElementById(
        'ot-notes'
      );

    // -----------------------------------------------------
    // VALIDATE REQUIRED ELEMENTS
    // -----------------------------------------------------

    if (!patientSelect) {

      throw new Error(
        'Theatre patient selector not found.'
      );

    }

    if (!procedureInput) {

      throw new Error(
        'Theatre procedure field not found.'
      );

    }

    // -----------------------------------------------------
    // THE SELECTOR CONTAINS THE REFERRAL ID
    // -----------------------------------------------------

    const referralId =
      patientSelect.value;

    if (!referralId) {

      alert(
        'Please select a patient referred to the Operating Theatre.'
      );

      return;
    }

    if (
      !procedureInput.value.trim()
    ) {

      alert(
        'Please enter the scheduled procedure.'
      );

      procedureInput.focus();

      return;
    }

    // -----------------------------------------------------
    // GET THE CURRENT REFERRAL FROM DATABASE
    // -----------------------------------------------------

    const referralsResponse =
      await fetch(
        '/api/surgery/referrals',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const referralsData =
      await referralsResponse
        .json()
        .catch(() => []);

    if (!referralsResponse.ok) {

      throw new Error(
        referralsData?.error ||
        'Failed to load theatre referrals.'
      );

    }

    const referrals =
      Array.isArray(referralsData)
        ? referralsData
        : (
            Array.isArray(
              referralsData?.referrals
            )
              ? referralsData.referrals
              : []
          );

    const referral =
      referrals.find(
        item =>
          String(item.id) ===
          String(referralId)
      );

    if (!referral) {

      alert(
        'The selected theatre referral is no longer pending.'
      );

      await loadTheatrePatients();

      return;
    }

    // -----------------------------------------------------
    // GET ACTUAL PATIENT DATABASE ID
    // -----------------------------------------------------

    const patientId =
      referral.patient_id;

    if (!patientId) {

      alert(
        'The selected referral has no patient ID.'
      );

      return;
    }

    // -----------------------------------------------------
    // BUILD SURGICAL RECORD
    // -----------------------------------------------------

    const postOpDestination = document.getElementById('ot-post-op-destination');

    const payload = {

      referral_id: Number(referral.id),

      patient_id:
        Number(patientId),

      post_op_destination: postOpDestination ? postOpDestination.value : '',

      procedure:
        procedureInput.value.trim(),

      consent:
        consentSelect
          ? consentSelect.value
          : '',

      surgeon_id:
        surgeonSelect &&
        surgeonSelect.value
          ? Number(
              surgeonSelect.value
            )
          : null,

      anaesthetist:
        anaesthetistInput
          ? anaesthetistInput.value.trim()
          : '',

      anaesthesia_type:
        anaesthesiaTypeSelect
          ? anaesthesiaTypeSelect.value
          : '',

      operation_notes:
        notesInput
          ? notesInput.value.trim()
          : '',

      status:
        'SCHEDULED'

    };

    console.log(
      'THEATRE SURGICAL RECORD PAYLOAD:',
      payload
    );

    // -----------------------------------------------------
    // SAVE TO DATABASE
    // -----------------------------------------------------

    const response =
      await fetch(
        '/api/surgery/',
        {
          method: 'POST',

          credentials:
            'same-origin',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify(
              payload
            )
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        'Failed to save surgical record.'
      );

    }

    console.log(
      'THEATRE SURGICAL RECORD SAVED:',
      data
    );

    // -----------------------------------------------------
    // SUCCESS
    // -----------------------------------------------------

    alert(
      'Surgical record saved successfully.'
    );

    // -----------------------------------------------------
    // RESET THE FORM
    // -----------------------------------------------------

    const form =
      event.target;

    if (form) {

      form.reset();

    }

    // -----------------------------------------------------
    // IMPORTANT:
    //
    // Remove the saved referral from the visible selector
    // immediately.
    //
    // We do this BEFORE reloading the queue so the user
    // never continues working on the already-saved patient.
    // -----------------------------------------------------

    const savedOption =
      patientSelect.querySelector(
        `option[value="${CSS.escape(
          String(referralId)
        )}"]`
      );

    if (savedOption) {

      savedOption.remove();

    }

    patientSelect.value = '';

    // -----------------------------------------------------
    // CLEAR DOCTOR REFERRAL INFORMATION
    // -----------------------------------------------------

    const clinicalContainer =
      document.getElementById(
        'theatre-doctor-notes'
      );

    if (clinicalContainer) {

      clinicalContainer.innerHTML =
        `<em>
          Select a patient to view doctor's instructions.
        </em>`;

    }

    // -----------------------------------------------------
    // RELOAD FROM DATABASE
    //
    // This is the important part:
    //
    // If the surgery backend has correctly completed the
    // theatre referral, it will no longer be returned.
    //
    // If it has NOT completed the referral, the database
    // will still return it and it will appear again.
    // -----------------------------------------------------

    await loadTheatrePatients();

    // -----------------------------------------------------
    // REFRESH OTHER HMS DATA
    // -----------------------------------------------------

    if (
      typeof refreshUI ===
      'function'
    ) {

      refreshUI();

    }

  } catch (error) {

    console.error(
      'SAVE SURGICAL RECORD ERROR:',
      error
    );

    alert(
      error.message ||
      'Failed to save the surgical record.'
    );

  }

}
// =========================================================
// NURSE - DOCTOR REFERRAL / CLINICAL INFORMATION
// =========================================================
async function loadNursePatients() {

  const select =
    document.getElementById(
      'nurse-patient-select'
    );

  /*
   * The Nursing module has three independent
   * database loads:
   *
   * 1. Available beds
   * 2. Inpatient ward patients
   * 3. Doctor nursing referrals
   *
   * None of these should prevent another from loading.
   */

  // =======================================================
  // AVAILABLE BEDS
  // =======================================================

  try {

    if (
      typeof loadNurseBeds ===
      'function'
    ) {

      await loadNurseBeds();

    }

  } catch (error) {

    console.error(
      'NURSE BED LOAD ERROR:',
      error
    );

  }

  // =======================================================
  // INPATIENT WARD CARE
  // =======================================================

  try {

    if (
      typeof loadInpatientWardCare ===
      'function'
    ) {

      await loadInpatientWardCare();

    }

  } catch (error) {

    console.error(
      'INPATIENT WARD LOAD ERROR:',
      error
    );

  }

  // =======================================================
  // REFERRED PATIENTS
  // =======================================================

  if (!select) {
    return;
  }

  select.innerHTML = `
    <option value="">
      Loading referred patients...
    </option>
  `;

  try {

    const response =
      await fetch(
        '/api/nursing/referrals',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await response.json()
        .catch(() => []);

    if (!response.ok) {

      throw new Error(
        data?.error ||
        data?.message ||
        'Failed to load nursing referrals.'
      );

    }

    /*
     * Your referral endpoint returns an array.
     */
    const referrals =
      Array.isArray(data)
        ? data
        : (
            Array.isArray(data?.referrals)
              ? data.referrals
              : []
          );

    select.innerHTML = `
      <option value="">
        -- Select Referred Patient --
      </option>

      ${
        referrals
          .map(
            referral => `
              <option
                value="${escapeHTML(
                  String(
                    referral.id
                  )
                )}"
                data-patient-id="${escapeHTML(String(referral.patient_id || ''))}"
              >
                ${escapeHTML(
                  referral.patient_code ||
                  referral.patient_id ||
                  ''
                )}
                -
                ${escapeHTML(
                  referral.patient_name ||
                  ''
                )}
              </option>
            `
          )
          .join('')
      }
    `;

    /*
     * Do not allow a missing referral list to
     * affect inpatient ward rendering.
     */
    if (
      typeof loadNurseClinicalInformation ===
      'function'
    ) {

      await loadNurseClinicalInformation();

    }

  } catch (error) {

    console.error(
      'NURSING REFERRAL LOAD ERROR:',
      error
    );

    select.innerHTML = `
      <option value="">
        No referred patients available
      </option>
    `;

  }

}

async function loadTheatreClinicalInformation() {

  const select =
    document.getElementById('ot-patient-select');

  const container =
    document.getElementById(
      'theatre-doctor-notes'
    );

  if (!container) return;

  const referralId =
    select?.value;

  if (!referralId) {

    container.innerHTML =
      `<em>
        Select a patient to view doctor's instructions.
      </em>`;

    return;
  }

  try {

    const response =
      await fetch('/api/surgery/referrals');

    if (!response.ok) {
      throw new Error(
        'Failed to load theatre referrals'
      );
    }

    const referrals =
      await response.json();

    const referral =
      referrals.find(
        item =>
          String(item.id) ===
          String(referralId)
      );

    if (!referral) {

      container.innerHTML =
        `<em>
          This theatre referral is no longer pending.
        </em>`;

      return;
    }

    container.innerHTML = `

      <div class="clinical-doctor-information">

        <h4>
          Doctor's Theatre Referral
        </h4>

        <div
          style="
            margin:8px 0;
            padding:12px;
            border:1px solid #ddd;
            border-radius:6px;
          "
        >

          <strong>
            Operating Theatre
          </strong>

          <br>

          <span>
            Status:
            ${escapeHTML(
              referral.status || 'PENDING'
            )}
          </span>

          <br>

          <strong>
            Referral Notes:
          </strong>

          <div>
            ${
              referral.notes
                ? escapeHTML(
                    referral.notes
                  )
                : '<em>No referral notes provided.</em>'
            }
          </div>

          ${
            referral.created_at
              ? `
                <small>
                  ${new Date(
                    referral.created_at
                  ).toLocaleString()}
                </small>
              `
              : ''
          }

        </div>

      </div>

    `;

  } catch (error) {

    console.error(
      'Failed to load theatre referral:',
      error
    );

    container.innerHTML =
      `<em>
        Unable to load doctor's referral.
      </em>`;
  }
}


// =========================================================
// BILLING FEED
// =========================================================

function getPatientBillingTotal(
  patient
) {

  if (!patient) return 0;

  return Number(
    patient.bill || 0
  );

}

// =========================================================
// BILLING FEED RENDERER
// =========================================================

function renderPatientBillingFeed(
  patient
) {

  const container =
    document.getElementById(
      'patient-billing-feed'
    );

  if (!container) return;

  if (!patient) {

    container.innerHTML =
      '<em>Select a patient.</em>';

    return;

  }

  const feed =
    patient.billingFeed || [];

  container.innerHTML = `

    <div>

      <strong>
        Clinical Billing Feed
      </strong>

      ${
        feed.length
          ? `

            <table
              style="width:100%;border-collapse:collapse;"
            >

              <thead>

                <tr>

                  <th>
                    Department
                  </th>

                  <th>
                    Description
                  </th>

                  <th>
                    Amount
                  </th>

                  <th>
                    Date
                  </th>

                </tr>

              </thead>

              <tbody>

                ${
                  feed
                    .map(
                      item => `

                        <tr>

                          <td>
                            ${escapeHTML(
                              item.department ||
                              item.type ||
                              ''
                            )}
                          </td>

                          <td>
                            ${escapeHTML(
                              item.description
                            )}
                          </td>

                          <td>
                            ${money(
                              item.amount
                            )}
                          </td>

                          <td>
                            ${escapeHTML(
                              new Date(
                                item.date
                              ).toLocaleString()
                            )}
                          </td>

                        </tr>

                      `
                    )
                    .join('')
                }

              </tbody>

            </table>

          `
          : '<em>No billing transactions.</em>'
      }

      <hr>

      <strong>
        Total Bill:
        ${money(patient.bill)}
      </strong>

      <br>

      <strong>
        Paid:
        ${money(patient.amountPaid)}
      </strong>

      <br>

      <strong>
        Balance:
        ${money(patient.balance)}
      </strong>

    </div>

  `;

}

// =========================================================
// ACCOUNTS
// =========================================================

function processPayment(event) {

  event.preventDefault();

  const pid =
    document.getElementById(
      'acc-patient-select'
    )?.value;

  const patient =
    state.patients.find(
      item =>
        item.id === pid
    );

  if (!patient) {

    alert(
      'Select a patient.'
    );

    return;

  }

  const amount =
    parseFloat(
      document.getElementById(
        'acc-amount'
      )?.value
    ) || 0;

  if (amount <= 0) {

    alert(
      'Enter a valid payment amount.'
    );

    return;

  }

  const discount =
    parseFloat(
      document.getElementById(
        'acc-discount'
      )?.value
    ) || 0;

  const total =
    Math.max(
      0,
      Number(patient.bill || 0) -
      discount
    );

  patient.amountPaid =
    Number(
      patient.amountPaid || 0
    ) + amount;

  patient.balance =
    Math.max(
      0,
      total -
      patient.amountPaid
    );

  if (
    !Array.isArray(
      patient.paymentHistory
    )
  ) {

    patient.paymentHistory = [];

  }

  if (
    !Array.isArray(
      patient.billingFeed
    )
  ) {

    patient.billingFeed = [];

  }

  patient.paymentHistory.push({

    amount,

    discount,

    date:
      new Date().toISOString()

  });

  patient.billingFeed.push({

    type:
      'payment',

    department:
      'Finance',

    description:
      'Patient payment',

    amount:
      amount,

    date:
      new Date().toISOString()

  });

  state.revenue +=
    amount;

  if (
    patient.balance <= 0
  ) {

    patient.billingStatus =
      'Paid in Full';

    patient.phase =
      'Completed';

  }

  else {

    patient.billingStatus =
      'Partially Paid';

    patient.phase =
      'Billing Queue';

  }

  logAudit(
    `Payment recorded for ${
      patient.id
    }. Amount: ${
      money(amount)
    }`
  );

  alert(
    `Payment recorded: ${money(amount)}`
  );

  event.target.reset();

  refreshUI();

}

// =========================================================
// BILL CALCULATION
// =========================================================

function calcBill() {

  const pid =
    document.getElementById(
      'acc-patient-select'
    )?.value;

  const patient =
    state.patients.find(
      item =>
        item.id === pid
    );

  if (!patient) return;

  const discount =
    parseFloat(
      document.getElementById(
        'acc-discount'
      )?.value
    ) || 0;

  const total =
    Math.max(
      0,
      Number(patient.bill || 0) -
      discount
    );

  const paid =
    Number(
      patient.amountPaid || 0
    );

  const balance =
    Math.max(
      0,
      total - paid
    );

  const amountEl =
    document.getElementById(
      'acc-amount'
    );

  if (amountEl) {

    amountEl.value =
      balance.toFixed(2);

  }

  renderPatientBillingFeed(
    patient
  );

}

// =========================================================
// LOAD ACCOUNTS PATIENT
// =========================================================

function loadAccountsPatient() {

  const pid =
    document.getElementById(
      'acc-patient-select'
    )?.value;

  const patient =
    state.patients.find(
      item =>
        item.id === pid
    );

  renderPatientBillingFeed(
    patient
  );

}

// =========================================================
// MEDICAL REPORTS
// =========================================================

function getSelectedReportPatient() {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  if (!select) return null;

  const patientId =
    select.value;

  if (!patientId) return null;

  return state.patients.find(
    patient =>
      patient.id === patientId
  ) || null;

}

// =========================================================
// REPORT TYPE
// =========================================================

function getReportType() {

  const select =
    document.getElementById(
      'medical-report-type'
    );

  return select
    ? select.value
    : 'complete';

}

// =========================================================
// REPORT VALUE
// =========================================================

function formatReportValue(
  value,
  fallback = 'Not recorded'
) {

  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {

    return fallback;

  }

  return escapeHTML(
    String(value)
  );

}

// =========================================================
// REPORT SECTION
// =========================================================

function createReportSection(
  title,
  rows
) {

  return {

    title,

    rows

  };

}

// =========================================================
// BUILD MEDICAL REPORT
// =========================================================

function buildMedicalReport(
  patient,
  reportType
) {

  const generatedAt =
    new Date().toLocaleString();

  const report = {

    id:
      `MR-${Date.now()}`,

    patientId:
      patient.id,

    patientName:
      patient.name,

    reportType,

    generatedAt,

    sections: []

  };

  const registrationSection =
    createReportSection(
      'Patient Registration',
      [

        [
          'Patient ID',
          patient.id
        ],

        [
          'Patient Name',
          patient.name
        ],

        [
          'Date of Birth',
          patient.dob
        ],

        [
          'Gender',
          patient.gender
        ],

        [
          'Phone',
          patient.phone
        ],

        [
          'Clinic / Department',
          patient.clinic
        ],

        [
          'Registration Date',
          patient.createdAt
            ? new Date(
                patient.createdAt
              ).toLocaleString()
            : ''
        ]

      ]
    );

  const triageSection =
    createReportSection(
      'Triage Assessment',
      [

        [
          'Weight',
          patient.vitals?.weight
        ],

        [
          'Height',
          patient.vitals?.height
        ],

        [
          'BMI',
          patient.vitals?.bmi
        ],

        [
          'Blood Pressure',
          patient.vitals?.bp
        ],

        [
          'Temperature',
          patient.vitals?.temp
        ],

        [
          'Pulse',
          patient.vitals?.pulse
        ],

        [
          'Respiratory Rate',
          patient.vitals?.rr
        ],

        [
          'SpO₂',
          patient.vitals?.spo2
        ],

        [
          'Blood Sugar',
          patient.vitals?.bs
        ],

        [
          'Pain Score',
          patient.vitals?.pain
        ],

        [
          'Chief Complaint',
          patient.vitals?.complaint
        ],

        [
          'Allergies',
          patient.vitals?.allergies
        ],

        [
          'Priority',
          patient.vitals?.priority
        ]

      ]
    );

  const doctorSection =
    createReportSection(
      'Doctor Consultation',
      [

        [
          'Diagnosis',
          patient.diagnosis
        ],

        [
          'Laboratory Request',
          patient.labRequest
        ],

        [
          'Laboratory Result',
          patient.labResult
        ],

        [
          'Radiology Request',
          patient.radRequest
        ],

        [
          'Radiology Result',
          patient.radResult
        ],

        [
          'Prescription',
          patient.prescription
        ],

        [
          'Medical Notes',
          (
            patient.doctorNotes || []
          )
            .map(
              note =>
                note.note
            )
            .join(' | ')
        ],

        [
          'Referral',
          (
            patient.referrals || []
          )
            .map(
              referral =>
                referral.department
            )
            .join(' | ')
        ],

        [
          'Follow-up Date',
          patient.followUp?.date
        ],

        [
          'Follow-up Notes',
          patient.followUp?.notes
        ]

      ]
    );

  const laboratorySection =
    createReportSection(
      'Laboratory',
      [

        [
          'Current Laboratory Request',
          patient.labRequest
        ],

        [
          'Current Laboratory Result',
          patient.labResult
        ],

        [
          'Laboratory Investigations Recorded',
          patient.laboratoryHistory?.length || 0
        ]

      ]
    );

  const radiologySection =
    createReportSection(
      'Radiology',
      [

        [
          'Current Imaging Request',
          patient.radRequest
        ],

        [
          'Current Imaging Findings',
          patient.radResult
        ],

        [
          'Radiology Investigations Recorded',
          patient.radiologyHistory?.length || 0
        ]

      ]
    );

  const pharmacySection =
    createReportSection(
      'Pharmacy',
      [

        [
          'Prescription',
          patient.prescription
        ],

        [
          'Medications Dispensed',
          patient.medications?.length || 0
        ],

        [
          'Clinical Status',
          patient.phase
        ]

      ]
    );

  const nursingSection =
    createReportSection(
      'Nursing / Inpatient',
      [

        [
          'Assigned Bed',
          patient.bed
        ],

        [
          'Nursing Records',
          patient.nursingHistory?.length || 0
        ],

        [
          'Doctor Notes',
          (
            patient.doctorNotes || []
          )
            .map(
              note =>
                note.note
            )
            .join(' | ')
        ],

        [
          'Follow-up Date',
          patient.followUp?.date
        ],

        [
          'Current Patient Phase',
          patient.phase
        ]

      ]
    );

  const theatreSection =
    createReportSection(
      'Operating Theatre',
      [

        [
          'Surgical Procedures Recorded',
          patient.theatreHistory?.length || 0
        ],

        [
          'Doctor Referrals',
          (
            patient.referrals || []
          )
            .map(
              referral =>
                referral.department
            )
            .join(' | ')
        ]

      ]
    );

  const accountsSection =
    createReportSection(
      'Finance / Billing',
      [

        [
          'Total Bill',
          money(patient.bill)
        ],

        [
          'Amount Paid',
          money(patient.amountPaid)
        ],

        [
          'Balance',
          money(patient.balance)
        ],

        [
          'Billing Status',
          patient.billingStatus
        ]

      ]
    );

  switch (reportType) {

    case 'registration':

      report.sections.push(
        registrationSection
      );

      break;

    case 'triage':

      report.sections.push(
        registrationSection,
        triageSection
      );

      break;

    case 'doctor':

      report.sections.push(
        registrationSection,
        triageSection,
        doctorSection
      );

      break;

    case 'laboratory':

      report.sections.push(
        registrationSection,
        laboratorySection
      );

      break;

    case 'radiology':

      report.sections.push(
        registrationSection,
        radiologySection
      );

      break;

    case 'pharmacy':

      report.sections.push(
        registrationSection,
        pharmacySection
      );

      break;

    case 'nurse':

      report.sections.push(
        registrationSection,
        triageSection,
        nursingSection
      );

      break;

    case 'theatre':

      report.sections.push(
        registrationSection,
        theatreSection
      );

      break;

    case 'accounts':

      report.sections.push(
        registrationSection,
        accountsSection
      );

      break;

    case 'complete':

    default:

      report.sections.push(

        registrationSection,

        triageSection,

        doctorSection,

        laboratorySection,

        radiologySection,

        pharmacySection,

        nursingSection,

        theatreSection,

        accountsSection

      );

      break;

  }

  return report;

}

// =========================================================
// LOAD OPD PATIENT
// DATABASE IS THE SOURCE OF TRUTH
// PRESERVES CURRENT SLIDE DURING REFRESH
// =========================================================

async function loadMedicalReportPatient() {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  const container =
    document.getElementById(
      'medical-reports-list'
    );

  if (
    !select ||
    !container
  ) {

    return;

  }

  const patientId =
    select.value;

  const previousSlide =
    Number(
      window.currentOPDReportSlide || 0
    );

  if (!patientId) {

    window.currentOPDPatientData =
      null;

    window.currentOPDReportSlide =
      0;

    container.innerHTML = `

      <div
        style="
          min-height:520px;
          display:flex;
          align-items:center;
          justify-content:center;
          text-align:center;
          padding:40px;
          color:#64748b;
        "
      >

        <div>

          <h3
            style="
              margin:0 0 10px 0;
              color:#334155;
            "
          >
            Finance Patient Records
          </h3>

          <p
            style="
              margin:0;
            "
          >
            Select a patient above to view account and billing records.
          </p>

        </div>

      </div>

    `;

    return;

  }

  container.innerHTML = `

    <div
      style="
        min-height:520px;
        display:flex;
        align-items:center;
        justify-content:center;
        color:#64748b;
      "
    >
      Loading account records...
    </div>

  `;

  try {

    const response =
      await fetch(
        `/api/opd/patient/${encodeURIComponent(patientId)}`,
        {
          method:
            'GET',

          credentials:
            'same-origin',

          cache:
            'no-store',

          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await response
        .json()
        .catch(
          function () {
            return {};
          }
        );

    if (
      !response.ok ||
      data.success === false
    ) {

      throw new Error(
        data.message ||
        data.error ||
        'Unable to load account records.'
      );

    }

    window.currentOPDPatientData =
      data;

    window.currentOPDPatientId =
      String(
        patientId
      );

    window.currentOPDReportSlide =
      previousSlide;

    renderFilteredMedicalReports(
      data
    );

  }

  catch (error) {

    console.error(
      'FAILED TO LOAD OPD RECORDS:',
      error
    );

    window.currentOPDPatientData =
      null;

    container.innerHTML = `

      <div
        style="
          min-height:520px;
          display:flex;
          align-items:center;
          justify-content:center;
          text-align:center;
          padding:40px;
          color:#b91c1c;
        "
      >

        <div>

          <h3>
            Unable to load account records
          </h3>

          <p>
            ${escapeHTML(
              error.message ||
              'Unknown error'
            )}
          </p>

        </div>

      </div>

    `;

  }

}

// =========================================================
// OPD FIELD HELPER
// MUST BE GLOBAL — USED BY ALL OPD RECORD CARDS
// =========================================================

window.opdField = function(label, value) {

    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        value = '—';
    }

    return `

        <div
            class="hms-data-field"
            style="
                width:100%;
                max-width:100%;
                min-width:0;
                box-sizing:border-box;
                padding:12px;
                border:1px solid #e2e8f0;
                border-radius:8px;
                background:#f8fafc;
                overflow-wrap:anywhere;
            "
        >

            <div
                class="hms-data-label"
                style="
                    width:100%;
                    max-width:100%;
                    min-width:0;
                    box-sizing:border-box;
                    font-size:12px;
                    color:#64748b;
                    margin-bottom:5px;
                    overflow-wrap:anywhere;
                "
            >
                ${escapeHTML(String(label))}
            </div>

            <div
                class="hms-data-value"
                style="
                    width:100%;
                    max-width:100%;
                    min-width:0;
                    box-sizing:border-box;
                    color:#0f172a;
                    white-space:pre-wrap;
                    overflow-wrap:anywhere;
                    word-break:normal;
                "
            >
                ${escapeHTML(String(value))}
            </div>

        </div>

    `;
};

// =========================================================
// OPD PATIENT INFORMATION CARD
// =========================================================

function renderOPDPatientInformation(
  patient
) {

  if (
    !patient ||
    typeof patient !== 'object'
  ) {

    return renderOPDNoRecord(
      'Patient information is not available.'
    );

  }

  const patientId =
    patient.patient_id ||
    patient.id ||
    '—';

  const fullName =
    patient.full_name ||
    patient.name ||
    '—';

  const dateOfBirth =
    patient.date_of_birth ||
    patient.dob ||
    '—';

  const gender =
    patient.gender ||
    '—';

  const phone =
    patient.phone ||
    '—';

  const clinic =
    patient.clinic ||
    patient.department ||
    '—';

  const currentPhase =
    patient.current_phase ||
    '—';

  const priority =
    patient.current_priority ||
    patient.priority ||
    '—';

  const status =
    patient.status ||
    '—';

  return `

    <div
      style="
        display:grid;
        grid-template-columns:
          repeat(
            auto-fit,
            minmax(
              220px,
              1fr
            )
          );
        gap:15px;
      "
    >

      ${opdField(
        'Patient ID',
        patientId
      )}

      ${opdField(
        'Full Name',
        fullName
      )}

      ${opdField(
        'Date of Birth',
        dateOfBirth
      )}

      ${opdField(
        'Gender',
        gender
      )}

      ${opdField(
        'Phone',
        phone
      )}

      ${opdField(
        'Clinic / Department',
        clinic
      )}

      ${opdField(
        'Current Phase',
        currentPhase
      )}

      ${opdField(
        'Priority',
        priority
      )}

      ${opdField(
        'Status',
        status
      )}

    </div>

  `;

}

// =========================================================
// RENDER OPD MEDICAL REPORTS
// BILLING IS INSIDE EVERY CARD
// FINAL CARD = OPD COMPLETION
// =========================================================

function renderFilteredMedicalReports(
  data
) {

  const container =
    document.getElementById(
      'medical-reports-list'
    );

  if (!container) {

    return;

  }

  if (!data) {

    return;

  }

  // Finance sees tariff invoices only; clinical journey records stay in
  // their clinical workspaces and never expose manual bill entry controls.
  const financePatient = data.patient || {};
  const financeRows = Array.isArray(data.billing) ? data.billing : [];
  window.currentOPDPatientData = data;
  container.innerHTML = renderFinanceInvoiceCard(financePatient, financeRows);
  return;

  window.currentOPDPatientData =
    data;

  const patient =
    data.patient ||
    {};

  const registration =
    data.registration ||
    {};

  const visits =
    Array.isArray(
      registration.visits
    )
      ? registration.visits
      : [];

  const triage =
    Array.isArray(
      data.triage
    )
      ? data.triage
      : [];

  const reports =
    data.reports ||
    {};

  const billing =
    Array.isArray(
      data.billing
    )
      ? data.billing
      : [];

  const referrals =
    Array.isArray(
      data.referrals
    )
      ? data.referrals
      : [];

  const cards = [

    {
      title:
        'Patient Information',

      icon:
        '👤',

      content:
        renderOPDPatientInformation(
          patient
        )
    },

    {
      title:
        'Registration / Visits',

      icon:
        '📋',

      content:
        renderOPDRegistrationRecords(
          visits
        )
    },

    {
      title:
        'Triage Record',

      icon:
        '🩺',

      content:
        renderOPDTriageRecord(
          triage
        )
    },

    {
      title:
        'Doctor Consultation Record',

      icon:
        '👨‍⚕️',

      content:
        renderOPDDoctorRecord(
          reports.doctor
        )
    },

    {
      title:
        'Pharmacy Record',

      icon:
        '💊',

      content:
        renderOPDPharmacyRecord(
          reports.pharmacy
        )
    },

    {
      title:
        'Laboratory Record',

      icon:
        '🧪',

      content:
        renderOPDLaboratoryRecord(
          reports.laboratory
        )
    },

    {
      title:
        'Radiology Record',

      icon:
        '🩻',

      content:
        renderOPDRadiologyRecord(
          reports.radiology
        )
    },

    {
      title:
        'Operating Theatre Record',

      icon:
        '🏥',

      content:
        renderOPDTheatreRecord(
          reports.theatre
        )
    },

    {
      title:
        'Nursing Record',

      icon:
        '👩‍⚕️',

      content:
        renderOPDNursingRecord(
          reports.nursing
        )
    },

    {
      title:
        'Referral History',

      icon:
        '🔄',

      content:
        renderOPDReferralRecords(
          referrals
        )
    },

    {
      title:
        'Patient Account Summary',

      icon:
        '✅',

      content:
        renderOPDCompletionCard(
          patient,
          billing,
          referrals
        )
    }

  ];

  const savedSlide =
    Number(
      window.currentOPDReportSlide || 0
    );

  container.innerHTML = `

    <div
      id="opd-report-slider"
      style="
        position:relative;
        width:100%;
        min-height:520px;
        overflow:hidden;
      "
    >

      ${cards.map(
        function (
          card,
          index
        ) {

          return `

            <div
              class="opd-report-slide"
              data-slide-index="${index}"
              onclick="advanceOPDReportSlide(event)"
              style="
                position:absolute;
                inset:0;
                width:100%;
                min-height:520px;
                box-sizing:border-box;
                padding:25px;
                display:none;
                transform:translateX(100%);
                opacity:0;
                transition:
                  transform .38s ease,
                  opacity .38s ease;
                cursor:pointer;
                overflow-y:auto;
              "
            >

              <div
                class="card"
                style="
                  width:100%;
                  min-height:470px;
                  margin:0;
                  box-sizing:border-box;
                "
              >

                <div
                  class="card-header"
                  style="
                    display:flex;
                    align-items:center;
                    gap:10px;
                  "
                >

                  <span>
                    ${card.icon}
                  </span>

                  <span>
                    ${escapeHTML(
                      card.title
                    )}
                  </span>

                </div>

                <div
                  style="
                    padding:25px;
                  "
                >

                  ${card.content}

                  ${
                    index <
                    cards.length - 1
                      ? renderOPDBilling(
                          billing,
                          card.title,
                          index
                        )
                      : ''
                  }

                  ${
                    index <
                    cards.length - 1
                      ? `
                        <div
                          style="
                            margin-top:25px;
                            text-align:center;
                            color:#94a3b8;
                            font-size:13px;
                          "
                        >
                          Click this card to view the next record.
                        </div>
                      `
                      : ''
                  }

                </div>

              </div>

            </div>

          `;

        }
      ).join('')}

    </div>

  `;

  const slideCount =
    cards.length;

  let targetSlide =
    savedSlide;

  if (
    targetSlide < 0
  ) {

    targetSlide =
      0;

  }

  if (
    targetSlide >= slideCount
  ) {

    targetSlide =
      slideCount - 1;

  }

  window.currentOPDReportSlide =
    targetSlide;

  showOPDReportSlide(
    targetSlide
  );

}

function renderFinanceInvoiceCard(patient, rows) {
  const safe = value => escapeHTML(String(value ?? ''));
  const total = key => rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
  const amount = total('amount'), discount = total('discount'), paid = total('amount_paid'), balance = total('balance');
  const items = rows.length ? rows.map(row => `
    <article class="finance-invoice-item">
      <div class="finance-invoice-item-head"><div><small>INVOICE</small><strong>${safe(row.invoice_number || '—')}</strong></div><span>${safe(row.bill_date ? new Date(row.bill_date).toLocaleDateString() : 'Date unavailable')}</span></div>
      <h4>${safe(row.description || row.service_type || 'Tariff service')}</h4>
      <dl><div><dt>Tariff charge</dt><dd>${money(row.amount)}</dd></div><div><dt>Waiver</dt><dd>${money(row.discount)}</dd></div><div><dt>Paid</dt><dd>${money(row.amount_paid)}</dd></div><div><dt>Balance</dt><dd><strong>${money(row.balance)}</strong></dd></div></dl>
      <div class="finance-invoice-actions"><button type="button" class="btn btn-secondary" onclick="printFinanceInvoice(${Number(row.id)})">Print invoice</button><button type="button" class="btn btn-primary" onclick="applyFinanceWaiver(${Number(row.id)},${Number(row.patient_id)})">Apply amount waiver</button></div>
    </article>`).join('') : '<p class="hms-muted finance-invoice-empty">No tariff invoices have been recorded for this patient yet. Charges appear as configured service steps are completed.</p>';
  return `<section class="finance-patient-invoice"><header><div><span class="finance-invoice-eyebrow">FINANCE · PATIENT INVOICES</span><h3>${safe(patient.full_name || patient.name || 'Patient')}</h3><p>Patient ID: ${safe(patient.patient_id || patient.id || '—')}</p></div><button type="button" class="btn btn-secondary" onclick="printAllFinanceInvoices()" ${rows.length ? '' : 'disabled'}>Print all invoices</button></header><div class="finance-invoice-totals"><div><small>Tariff charges</small><strong>${money(amount)}</strong></div><div><small>Waivers</small><strong>${money(discount)}</strong></div><div><small>Paid</small><strong>${money(paid)}</strong></div><div><small>Outstanding</small><strong>${money(balance)}</strong></div></div><div class="finance-invoice-list">${items}</div></section>`;
}

function financeInvoicePrintHtml(rows, patient) {
  const safe = value => escapeHTML(String(value ?? ''));
  const sum = rows.reduce((total, row) => total + (Number(row.amount) || 0), 0);
  const waiver = rows.reduce((total, row) => total + (Number(row.discount) || 0), 0);
  const paid = rows.reduce((total, row) => total + (Number(row.amount_paid) || 0), 0);
  const balance = rows.reduce((total, row) => total + (Number(row.balance) || 0), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Finance Invoice</title><style>body{font:14px Arial,sans-serif;color:#172033;margin:28px}header{border-bottom:2px solid #0f5968;padding-bottom:14px;margin-bottom:18px}h1{margin:0 0 6px;font-size:22px}p{margin:4px 0;color:#475569}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{text-align:left;padding:9px;border-bottom:1px solid #cbd5e1}th{background:#f1f5f9}.totals{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.totals div{padding:12px;background:#f1f5f9;border-radius:6px}.totals small,.totals strong{display:block}.totals small{color:#64748b}.totals strong{margin-top:4px}</style></head><body><header><h1>HOSPITALSAVVY · FINANCE INVOICE</h1><p>${safe(patient.full_name || patient.name || 'Patient')} · Patient ID: ${safe(patient.patient_id || patient.id || '—')}</p></header><table><thead><tr><th>Invoice</th><th>Date</th><th>Service</th><th>Charge</th><th>Waiver</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${safe(row.invoice_number)}</td><td>${safe(row.bill_date?new Date(row.bill_date).toLocaleDateString():'')}</td><td>${safe(row.description||row.service_type)}</td><td>${money(row.amount)}</td><td>${money(row.discount)}</td><td>${money(row.amount_paid)}</td><td>${money(row.balance)}</td></tr>`).join('')}</tbody></table><div class="totals"><div><small>Tariff charges</small><strong>${money(sum)}</strong></div><div><small>Waivers</small><strong>${money(waiver)}</strong></div><div><small>Paid</small><strong>${money(paid)}</strong></div><div><small>Outstanding</small><strong>${money(balance)}</strong></div></div><p style="margin-top:24px">Printed ${new Date().toLocaleString()}</p></body></html>`;
}

window.printFinanceInvoice = function(billingId) {
  const data = window.currentOPDPatientData || {};
  const row = (data.billing || []).find(item => Number(item.id) === Number(billingId));
  if (!row) return alert('Invoice is no longer available. Refresh the patient card.');
  const popup = window.open('', '_blank', 'width=900,height=700');
  if (!popup) return alert('Allow pop-ups to print this invoice.');
  popup.document.write(financeInvoicePrintHtml([row], data.patient || {}));
  popup.document.close(); popup.focus(); popup.print();
};

window.printAllFinanceInvoices = function() {
  const data = window.currentOPDPatientData || {};
  const rows = Array.isArray(data.billing) ? data.billing : [];
  if (!rows.length) return;
  const popup = window.open('', '_blank', 'width=1000,height=750');
  if (!popup) return alert('Allow pop-ups to print these invoices.');
  popup.document.write(financeInvoicePrintHtml(rows, data.patient || {}));
  popup.document.close(); popup.focus(); popup.print();
};

window.applyFinanceWaiver = async function(billingId, patientId) {
  const data = window.currentOPDPatientData || {};
  const bill = (data.billing || []).find(item => Number(item.id) === Number(billingId));
  if (!bill) return alert('Invoice is no longer available. Refresh the patient card.');
  const entered = window.prompt('Enter the total waiver amount for this invoice:', String(Number(bill.discount || 0)));
  if (entered === null) return;
  const waiver = Number(entered);
  if (!Number.isFinite(waiver) || waiver < 0 || waiver > Number(bill.amount || 0)) return alert('Enter a valid waiver between zero and the tariff charge.');
  try {
    const response = await fetch('/api/billing/discount', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({patient_id:patientId,billing_id:billingId,discount:waiver})});
    const result = await response.json().catch(()=>({}));
    if (!response.ok || !result.success) throw new Error(result.error || 'Could not apply the waiver.');
    await loadMedicalReportPatient();
  } catch (error) { alert(error.message); }
};

// =========================================================
// NO RECORD
// =========================================================

function renderOPDNoRecord(message) {

  return `

    <div
      style="
        padding:35px;
        text-align:center;
        color:#64748b;
        border:1px dashed #cbd5e1;
        border-radius:10px;
        background:#f8fafc;
      "
    >

      ${escapeHTML(message)}

    </div>

  `;
}

function renderOPDTriageRecord(triage) {

  if (
    !Array.isArray(triage) ||
    !triage.length
  ) {

    return renderOPDNoRecord(
      'No triage record found.'
    );

  }

  return `

    <div>

      ${triage.map(
        (record, index) => `

          <div
            style="
              padding:15px;
              margin-bottom:15px;
              border:1px solid #e2e8f0;
              border-radius:8px;
              background:#f8fafc;
            "
          >

            <div
              style="
                margin-bottom:15px;
                font-weight:600;
                color:#0f172a;
              "
            >
              Triage Record ${index + 1}
            </div>

            <div class="opd-record-grid">

              ${opdField(
                'Triage Record ID',
                record.id
              )}

              ${opdField(
                'Patient ID',
                record.patient_id
              )}

              ${opdField(
                'Weight',
                record.weight
              )}

              ${opdField(
                'Height',
                record.height
              )}

              ${opdField(
                'BMI',
                record.bmi
              )}

              ${opdField(
                'Blood Pressure',
                record.blood_pressure
              )}

              ${opdField(
                'Temperature',
                record.temperature
              )}

              ${opdField(
                'Pulse',
                record.pulse
              )}

              ${opdField(
                'Respiratory Rate',
                record.respiratory_rate
              )}

              ${opdField(
                'SpO₂',
                record.spo2
              )}

              ${opdField(
                'Blood Sugar',
                record.blood_sugar
              )}

              ${opdField(
                'Pain Score',
                record.pain_score
              )}

              ${opdField(
                'Chief Complaint',
                record.chief_complaint
              )}

              ${opdField(
                'Allergies',
                record.allergies
              )}

              ${opdField(
                'Pregnancy Status',
                record.pregnancy_status
              )}

              ${opdField(
                'GCS',
                record.gcs
              )}

              ${opdField(
                'Fall Risk',
                record.fall_risk
              )}

              ${opdField(
                'Priority',
                record.priority
              )}

              ${opdField(
                'Recorded',
                record.created_at
                  ? new Date(
                      record.created_at
                    ).toLocaleString()
                  : null
              )}

            </div>

          </div>

        `
      ).join('')}

    </div>

  `;

}

function renderOPDDoctorRecord(records) {

  if (
    !Array.isArray(records) ||
    !records.length
  ) {

    return renderOPDNoRecord(
      'No doctor consultation record found.'
    );

  }

  return `

    <div>

      ${records.map(
        (record, index) => `

          <div
            style="
              padding:15px;
              margin-bottom:15px;
              border:1px solid #e2e8f0;
              border-radius:8px;
              background:#f8fafc;
            "
          >

            <div
              style="
                margin-bottom:15px;
                font-weight:600;
                color:#0f172a;
              "
            >
              Doctor Consultation ${index + 1}
            </div>

            <div class="opd-record-grid">

              ${opdField(
                'Clinical Record ID',
                record.id
              )}

              ${opdField(
                'History of Present Illness',
                record.hpi
              )}

              ${opdField(
                'Past Medical History',
                record.past_history
              )}

              ${opdField(
                'Examination',
                record.examination
              )}

              ${opdField(
                'Social History',
                record.social_history
              )}

              ${opdField(
                'Provisional Diagnosis',
                record.provisional_diagnosis
              )}

              ${opdField(
                'Differential Diagnosis',
                record.differential_diagnosis
              )}

              ${opdField(
                'Final Diagnosis',
                record.final_diagnosis
              )}

              ${opdField(
                'Laboratory Ordered',
                record.lab_order
              )}

              ${opdField(
                'Radiology Ordered',
                record.radiology_order
              )}

              ${opdField(
                'Prescription',
                record.prescription
              )}

              ${opdField(
                'Prescription Frequency',
                record.prescription_frequency
              )}

              ${opdField(
                'Prescription Duration',
                record.prescription_duration
              )}

              ${opdField(
                'Referral Destination',
                record.referral_destination
              )}

              ${opdField(
                'Referral Notes',
                record.referral_notes
              )}

              ${opdField(
                'Review Date',
                record.review_date
              )}

              ${opdField(
                'Record Date',
                record.created_at
                  ? new Date(
                      record.created_at
                    ).toLocaleString()
                  : null
              )}

            </div>

          </div>

        `
      ).join('')}

    </div>

  `;

}

function renderOPDPharmacyRecord(records) {

  if (
    !Array.isArray(records) ||
    !records.length
  ) {

    return renderOPDNoRecord(
      'No pharmacy record found.'
    );

  }

  return `

    <div style="overflow-x:auto;">

      <table class="medical-report-table">

        <thead>

          <tr>
            <th>Record ID</th>
            <th>Medication</th>
            <th>Quantity</th>
            <th>Dosage</th>
            <th>Frequency</th>
            <th>Duration</th>
            <th>Total Amount</th>
            <th>Dispensed By</th>
            <th>Status</th>
            <th>Date</th>
          </tr>

        </thead>

        <tbody>

          ${records.map(
            item => `

              <tr>

                <td>
                  ${escapeHTML(
                    item.id ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.medication_name ||
                    item.medicine_name ||
                    '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.quantity ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.dosage || '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.frequency || '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.duration || '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.total_amount ?? '0'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.dispensed_by ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.status || '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    item.created_at
                      ? new Date(
                          item.created_at
                        ).toLocaleString()
                      : '—'
                  )}
                </td>

              </tr>

            `
          ).join('')}

        </tbody>

      </table>

    </div>

  `;

}

function renderOPDRadiologyRecord(records) {

    if (!Array.isArray(records) || records.length === 0) {
        return `
            <div style="
                padding:20px;
                text-align:center;
                color:#64748b;
            ">
                No radiology records found.
            </div>
        `;
    }

    return records.map(item => {

        const result =
            item.result ||
            {};

        const imageUrl =
            item.image_url ||
            result.image_url ||
            null;

        const findings =
            item.findings ||
            result.findings ||
            'No findings recorded.';

        const reportedBy =
            item.reported_by ||
            result.reported_by ||
            'Not recorded';

        const resultDate =
            result.created_at ||
            item.result_date ||
            item.created_at ||
            '';

        return `
            <div class="card" style="
                margin-bottom:15px;
                overflow:hidden;
                max-width:100%;
                box-sizing:border-box;
            ">

                <div class="card-header" style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:10px;
                    flex-wrap:wrap;
                ">
                    <span>
                        Radiology Record
                    </span>

                    <span>
                        ${escapeHTML(
                            item.status ||
                            'Recorded'
                        )}
                    </span>
                </div>

                <div style="
                    padding:16px;
                    max-width:100%;
                    box-sizing:border-box;
                ">

                    <div style="
                        display:grid;
                        grid-template-columns:
                            repeat(auto-fit, minmax(220px, 1fr));
                        gap:12px;
                        max-width:100%;
                    ">

                        <div>
                            <strong>Request Record ID:</strong><br>
                            ${escapeHTML(
                                item.id ??
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Request ID:</strong><br>
                            ${escapeHTML(
                                item.request_id ??
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Examination:</strong><br>
                            ${escapeHTML(
                                item.examination ||
                                item.exam_name ||
                                item.test_name ||
                                item.investigation ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Status:</strong><br>
                            ${escapeHTML(
                                item.status ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Reported By:</strong><br>
                            ${escapeHTML(
                                reportedBy
                            )}
                        </div>

                        <div>
                            <strong>Requested:</strong><br>
                            ${escapeHTML(
                                item.created_at ||
                                item.requested_at ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Recorded:</strong><br>
                            ${escapeHTML(
                                resultDate ||
                                'N/A'
                            )}
                        </div>

                    </div>

                    <div style="
                        margin-top:16px;
                        padding:14px;
                        border:1px solid #e2e8f0;
                        border-radius:8px;
                        background:#f8fafc;
                        max-width:100%;
                        box-sizing:border-box;
                        overflow-wrap:anywhere;
                        word-break:break-word;
                    ">

                        <strong>Findings:</strong>

                        <div style="
                            margin-top:8px;
                            white-space:pre-wrap;
                            overflow-wrap:anywhere;
                            word-break:break-word;
                            max-width:100%;
                        ">
                            ${escapeHTML(
                                findings
                            )}
                        </div>

                    </div>

                    ${
                        imageUrl
                        ? `
                            <div style="
                                margin-top:16px;
                                padding:14px;
                                border:1px solid #e2e8f0;
                                border-radius:8px;
                                background:#f8fafc;
                                max-width:100%;
                                box-sizing:border-box;
                            ">

                                <strong>
                                    Radiology Scan
                                </strong>

                                <div style="
                                    margin-top:12px;
                                    width:100%;
                                    max-width:100%;
                                    overflow:hidden;
                                    text-align:center;
                                    box-sizing:border-box;
                                ">

                                    <img
                                        src="${escapeHTML(imageUrl)}"
                                        alt="Radiology Scan"
                                        style="
                                            display:block;
                                            max-width:100%;
                                            width:auto;
                                            height:auto;
                                            max-height:650px;
                                            margin:0 auto;
                                            object-fit:contain;
                                            border-radius:6px;
                                            box-sizing:border-box;
                                        "
                                    >

                                </div>

                                <div style="
                                    margin-top:10px;
                                    text-align:center;
                                ">

                                    <a
                                        href="${escapeHTML(imageUrl)}"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Open full-size scan
                                    </a>

                                </div>

                            </div>
                        `
                        : `
                            <div style="
                                margin-top:16px;
                                padding:14px;
                                border:1px solid #e2e8f0;
                                border-radius:8px;
                                color:#64748b;
                                background:#f8fafc;
                            ">
                                No radiology scan has been attached
                                to this result.
                            </div>
                        `
                    }

                </div>

            </div>
        `;

    }).join('');

}

function renderOPDLaboratoryRecord(records) {

    if (!Array.isArray(records) || records.length === 0) {
        return `
            <div style="
                padding:20px;
                text-align:center;
                color:#64748b;
            ">
                No laboratory records found.
            </div>
        `;
    }

    return records.map(item => {

        const resultDetails =
            item.result_details || {};

        const reportedBy =
            resultDetails.verified_by ||
            item.verified_by ||
            'Not recorded';

        const resultDate =
            resultDetails.created_at ||
            item.result_date ||
            item.created_at ||
            '';

        return `
            <div class="card" style="
                margin-bottom:15px;
                overflow:hidden;
                max-width:100%;
                box-sizing:border-box;
            ">

                <div class="card-header" style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:10px;
                    flex-wrap:wrap;
                ">
                    <span>
                        Laboratory Record
                    </span>

                    <span>
                        ${escapeHTML(
                            item.status ||
                            resultDetails.verification_status ||
                            'Recorded'
                        )}
                    </span>
                </div>

                <div style="
                    padding:16px;
                    max-width:100%;
                    box-sizing:border-box;
                ">

                    <div style="
                        display:grid;
                        grid-template-columns:
                            repeat(auto-fit, minmax(220px, 1fr));
                        gap:12px;
                        max-width:100%;
                    ">

                        <div>
                            <strong>Request Record ID:</strong><br>
                            ${escapeHTML(
                                item.id ??
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Request ID:</strong><br>
                            ${escapeHTML(
                                item.request_id ??
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Test:</strong><br>
                            ${escapeHTML(
                                item.test_name ||
                                item.test ||
                                item.investigation ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Sample Type:</strong><br>
                            ${escapeHTML(
                                item.sample_type ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Barcode:</strong><br>
                            ${escapeHTML(
                                item.barcode ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Result ID:</strong><br>
                            ${escapeHTML(
                                resultDetails.id ??
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Verification Status:</strong><br>
                            ${escapeHTML(
                                resultDetails.verification_status ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Reported By:</strong><br>
                            ${escapeHTML(
                                reportedBy
                            )}
                        </div>

                        <div>
                            <strong>Requested:</strong><br>
                            ${escapeHTML(
                                item.created_at ||
                                item.requested_at ||
                                'N/A'
                            )}
                        </div>

                        <div>
                            <strong>Recorded:</strong><br>
                            ${escapeHTML(
                                resultDate ||
                                'N/A'
                            )}
                        </div>

                    </div>

                    <div style="
                        margin-top:16px;
                        padding:14px;
                        border:1px solid #e2e8f0;
                        border-radius:8px;
                        background:#f8fafc;
                        max-width:100%;
                        box-sizing:border-box;
                        overflow-wrap:anywhere;
                        word-break:break-word;
                    ">

                        <strong>Result:</strong>

                        <div style="
                            margin-top:8px;
                            white-space:pre-wrap;
                            overflow-wrap:anywhere;
                            word-break:break-word;
                            max-width:100%;
                        ">
                            ${escapeHTML(
                                item.result ||
                                resultDetails.results ||
                                'No result recorded.'
                            )}
                        </div>

                    </div>

                    <div style="
                        margin-top:12px;
                        padding:14px;
                        border:1px solid #e2e8f0;
                        border-radius:8px;
                        max-width:100%;
                        box-sizing:border-box;
                        overflow-wrap:anywhere;
                        word-break:break-word;
                    ">

                        <strong>Result Details:</strong>

                        <div style="
                            margin-top:8px;
                            white-space:pre-wrap;
                            overflow-wrap:anywhere;
                            word-break:break-word;
                            max-width:100%;
                        ">
                            ${escapeHTML(
                                resultDetails.results ||
                                item.result ||
                                'No additional result details.'
                            )}
                        </div>

                    </div>

                </div>

            </div>
        `;

    }).join('');

}

function renderOPDTheatreRecord(records) {

  if (
    !Array.isArray(records) ||
    !records.length
  ) {

    return renderOPDNoRecord(
      'No operating theatre record found.'
    );

  }

  return `

    <div>

      ${records.map(
        (record, index) => `

          <div
            style="
              padding:15px;
              margin-bottom:15px;
              border:1px solid #e2e8f0;
              border-radius:8px;
              background:#f8fafc;
            "
          >

            <div
              style="
                margin-bottom:15px;
                font-weight:600;
                color:#0f172a;
              "
            >
              Operating Theatre Record ${index + 1}
            </div>

            <div class="opd-record-grid">

              ${opdField(
                'Record ID',
                record.id
              )}

              ${opdField(
                'Procedure',
                record.procedure
              )}

              ${opdField(
                'Diagnosis',
                record.diagnosis
              )}

              ${opdField(
                'Surgeon',
                record.surgeon
              )}

              ${opdField(
                'Anaesthesia',
                record.anaesthesia
              )}

              ${opdField(
                'Status',
                record.status
              )}

              ${opdField(
                'Notes',
                record.notes
              )}

              ${opdField(
                'Procedure / Record Date',
                record.created_at
                  ? new Date(
                      record.created_at
                    ).toLocaleString()
                  : null
              )}

            </div>

          </div>

        `
      ).join('')}

    </div>

  `;

}

function renderOPDNursingRecord(records) {

  if (
    !Array.isArray(records) ||
    !records.length
  ) {

    return renderOPDNoRecord(
      'No nursing record found.'
    );

  }

  return `

    <div>

      ${records.map(
        (record, index) => `

          <div
            style="
              padding:15px;
              margin-bottom:15px;
              border:1px solid #e2e8f0;
              border-radius:8px;
              background:#f8fafc;
            "
          >

            <div
              style="
                margin-bottom:15px;
                font-weight:600;
                color:#0f172a;
              "
            >
              Nursing Care Session ${
                record.session_number ||
                (index + 1)
              }
            </div>

            <div class="opd-record-grid">

              ${opdField(
                'Record ID',
                record.id
              )}

              ${opdField(
                'Session Number',
                record.session_number
              )}

              ${opdField(
                'Assessment',
                record.assessment
              )}

              ${opdField(
                'Nursing Notes',
                record.nursing_notes
              )}

              ${opdField(
                'Care Plan',
                record.care_plan
              )}

              ${opdField(
                'Interventions',
                record.interventions
              )}

              ${opdField(
                'Medication Notes',
                record.medication_notes
              )}

              ${opdField(
                'Patient Response',
                record.patient_response
              )}

              ${opdField(
                'Vital Signs',
                record.vital_signs
              )}

              ${opdField(
                'Shift',
                record.shift
              )}

              ${opdField(
                'Status',
                record.status
              )}

              ${opdField(
                'Service Date',
                record.created_at
                  ? new Date(
                      record.created_at
                    ).toLocaleString()
                  : null
              )}

            </div>

          </div>

        `
      ).join('')}

    </div>

  `;

}

function renderOPDRegistrationRecords(visits) {

  if (
    !Array.isArray(visits) ||
    !visits.length
  ) {

    return renderOPDNoRecord(
      'No registration or visit records found.'
    );

  }

  return `

    <div style="overflow-x:auto;">

      <table class="medical-report-table">

        <thead>

          <tr>
            <th>Visit ID</th>
            <th>Database ID</th>
            <th>Department ID</th>
            <th>Status</th>
            <th>Date</th>
          </tr>

        </thead>

        <tbody>

          ${visits.map(
            visit => `

              <tr>

                <td>
                  ${escapeHTML(
                    visit.visit_id ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    visit.id ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    visit.department_id ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    visit.status ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    visit.created_at
                      ? new Date(
                          visit.created_at
                        ).toLocaleString()
                      : '—'
                  )}
                </td>

              </tr>

            `
          ).join('')}

        </tbody>

      </table>

    </div>

  `;

}

function renderOPDReferralRecords(referrals) {

  if (
    !Array.isArray(referrals) ||
    !referrals.length
  ) {

    return renderOPDNoRecord(
      'No referral records found.'
    );

  }

  return `

    <div style="overflow-x:auto;">

      <table class="medical-report-table">

        <thead>

          <tr>
            <th>Referral ID</th>
            <th>Destination</th>
            <th>Notes</th>
            <th>Status</th>
            <th>Date</th>
          </tr>

        </thead>

        <tbody>

          ${referrals.map(
            referral => `

              <tr>

                <td>
                  ${escapeHTML(
                    referral.id ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    referral.destination ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    referral.notes ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    referral.status ?? '—'
                  )}
                </td>

                <td>
                  ${escapeHTML(
                    referral.created_at
                      ? new Date(
                          referral.created_at
                        ).toLocaleString()
                      : '—'
                  )}
                </td>

              </tr>

            `
          ).join('')}

        </tbody>

      </table>

    </div>

  `;

}
// =========================================================
// OPD BILLING
// SHOWN INSIDE EVERY MEDICAL CARD
// CUMULATIVE BILLING FOR THE PATIENT
// =========================================================

// =========================================================
// OPD BILLING
// ONE BILLING RECORD PER OPD CARD
// EXISTING CARD BILL IS EDITED
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

function renderOPDBilling(
  billing,
  cardTitle,
  cardIndex
) {

  const rows =
    Array.isArray(
      billing
    )
      ? billing
      : [];

  const cardNumber =
    cardIndex + 1;

  const primaryDescription =
    `Patient Visit - Card ${cardNumber}`;

  const legacyDescription =
    `OPD - ${cardNumber}`;

  /*
   * Find the billing record belonging
   * to this exact OPD card.
   *
   * The billing endpoint returns newest
   * records first, so find() gives us
   * the newest matching record.
   */

  const existingBill =
    rows.find(
      function (
        bill
      ) {

        const description =
          String(
            bill.description ||
            ''
          ).trim();

        return (
          description ===
            primaryDescription ||
          description ===
            legacyDescription
        );

      }
    ) || null;

  const existingAmount =
    existingBill
      ? Number(
          existingBill.amount || 0
        )
      : 0;

  const existingDiscount =
    existingBill
      ? Number(
          existingBill.discount || 0
        )
      : 0;

  const existingPaid =
    existingBill
      ? Number(
          existingBill.amount_paid || 0
        )
      : 0;

  const existingBalance =
    existingBill
      ? Number(
          existingBill.balance || 0
        )
      : 0;

  /*
   * CUMULATIVE PATIENT TOTALS
   */

  let totalAmount =
    0;

  let totalDiscount =
    0;

  let totalPaid =
    0;

  let totalBalance =
    0;

  rows.forEach(
    function (
      bill
    ) {

      totalAmount +=
        Number(
          bill.amount || 0
        );

      totalDiscount +=
        Number(
          bill.discount || 0
        );

      totalPaid +=
        Number(
          bill.amount_paid || 0
        );

      totalBalance +=
        Number(
          bill.balance || 0
        );

    }
  );

  const totalPayable =
    Math.max(
      0,
      totalAmount -
      totalDiscount
    );

  const paymentMethod =
    existingBill &&
    existingBill.payment_method
      ? existingBill.payment_method
      : 'Cash';

  return `

    <div
      class="opd-billing-section"
      style="
        margin-top:25px;
        padding:20px;
        border-top:2px solid #e2e8f0;
      "
      onclick="event.stopPropagation()"
    >

      <h4
        style="
          margin:0 0 15px 0;
        "
      >
        Finance & Billing
      </h4>

      ${opdField(
        'Billing Card',
        cardTitle
      )}

      <div
        style="
          display:grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(
                150px,
                1fr
              )
            );
          gap:12px;
          margin-top:15px;
          margin-bottom:18px;
        "
      >

        ${opdField(
          'Cumulative Bill',
          totalAmount.toFixed(2)
        )}

        ${opdField(
          'Cumulative Discount',
          totalDiscount.toFixed(2)
        )}

        ${opdField(
          'Total Payable',
          totalPayable.toFixed(2)
        )}

        ${opdField(
          'Cumulative Paid',
          totalPaid.toFixed(2)
        )}

        ${opdField(
          'Cumulative Balance',
          totalBalance.toFixed(2)
        )}

      </div>

      <div
        style="
          display:grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(
                160px,
                1fr
              )
            );
          gap:12px;
          align-items:end;
        "
      >

        <div>

          <label>
            Bill Amount
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            class="form-control opd-slide-bill"
            value="${existingAmount}"
          >

        </div>

        <div>

          <label>
            Discount / Waiver
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            class="form-control opd-slide-discount"
            value="${existingDiscount}"
          >

        </div>

        <div>

          <label>
            Amount Paid
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            class="form-control opd-slide-paid"
            value="${existingPaid}"
          >

        </div>

        <div>

          <label>
            Payment Method
          </label>

          <select
            class="form-control opd-slide-payment-method"
          >

            <option
              value="Cash"
              ${
                paymentMethod === 'Cash'
                  ? 'selected'
                  : ''
              }
            >
              Cash
            </option>

            <option
              value="Mobile Money"
              ${
                paymentMethod === 'Mobile Money'
                  ? 'selected'
                  : ''
              }
            >
              Mobile Money
            </option>

            <option
              value="Card"
              ${
                paymentMethod === 'Card'
                  ? 'selected'
                  : ''
              }
            >
              Card
            </option>

            <option
              value="Bank"
              ${
                paymentMethod === 'Bank'
                  ? 'selected'
                  : ''
              }
            >
              Bank
            </option>

          </select>

        </div>

        <div>

          <button
            type="button"
            class="btn btn-primary"
            data-billing-id="${
              existingBill
                ? existingBill.id
                : ''
            }"
            onclick="
              processOPDSlidePayment(
                this
              )
            "
          >

            ${
              existingBill
                ? 'Update Billing'
                : 'Save Billing'
            }

          </button>

        </div>

      </div>

      ${
        existingBill
          ? `

            <div
              style="
                margin-top:10px;
                color:#64748b;
                font-size:13px;
              "
            >

              Existing invoice:
              <strong>
                ${escapeHTML(
                  existingBill.invoice_number ||
                  '—'
                )}
              </strong>

              <br>

              Invoice ID:
              ${escapeHTML(
                existingBill.id
              )}

            </div>

          `
          : ''
      }

      <div
        style="
          margin-top:20px;
        "
      >

        <h5>
          Complete Billing History
        </h5>

        ${
          rows.length
            ? `

              <div
                style="
                  overflow-x:auto;
                "
              >

                <table
                  class="medical-report-table"
                >

                  <thead>

                    <tr>

                      <th>
                        Invoice
                      </th>

                      <th>
                        Date
                      </th>

                      <th>
                        Service
                      </th>

                      <th>
                        Amount
                      </th>

                      <th>
                        Discount
                      </th>

                      <th>
                        Total
                      </th>

                      <th>
                        Paid
                      </th>

                      <th>
                        Balance
                      </th>

                      <th>
                        Method
                      </th>

                      <th>
                        Status
                      </th>

                    </tr>

                  </thead>

                  <tbody>

                    ${
                      rows.map(
                        function (
                          bill
                        ) {

                          return `

                            <tr>

                              <td>
                                ${escapeHTML(
                                  bill.invoice_number ||
                                  '—'
                                )}
                              </td>

                              <td>
                                ${escapeHTML(
                                  bill.bill_date ||
                                  bill.created_at ||
                                  '—'
                                )}
                              </td>

                              <td>
                                ${escapeHTML(
                                  (bill.description || bill.service_type || 'Patient service').replace(/^OPD\b/i, 'Patient Visit')
                                )}
                              </td>

                              <td>
                                ${Number(
                                  bill.amount || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.discount || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.total_amount || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.amount_paid || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.balance || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${escapeHTML(
                                  bill.payment_method ||
                                  '—'
                                )}
                              </td>

                              <td>
                                ${escapeHTML(
                                  bill.payment_status ||
                                  bill.status ||
                                  '—'
                                )}
                              </td>

                            </tr>

                          `;

                        }
                      ).join('')
                    }

                  </tbody>

                </table>

              </div>

            `
            : `

              <div
                style="
                  color:#64748b;
                  padding:15px 0;
                "
              >
                No billing records have been saved yet.
              </div>

            `
        }

      </div>

    </div>

  `;

}

// =========================================================
// OPD COMPLETION CARD
// FINAL CARD
// =========================================================

function renderOPDCompletionCard(
  patient,
  billing,
  referrals
) {

  const rows =
    Array.isArray(
      billing
    )
      ? billing
      : [];

  let totalAmount =
    0;

  let totalDiscount =
    0;

  let totalPaid =
    0;

  let totalBalance =
    0;

  rows.forEach(
    function (
      bill
    ) {

      totalAmount +=
        Number(
          bill.amount || 0
        );

      totalDiscount +=
        Number(
          bill.discount || 0
        );

      totalPaid +=
        Number(
          bill.amount_paid || 0
        );

      totalBalance +=
        Number(
          bill.balance || 0
        );

    }
  );

  const totalPayable =
    Math.max(
      0,
      totalAmount -
      totalDiscount
    );

  const pendingOPDReferrals =
    Array.isArray(
      referrals
    )
      ? referrals.filter(
          function (
            referral
          ) {

            return (
              String(
                referral.destination || ''
              ).toLowerCase() ===
                'op' &&

              String(
                referral.status || ''
              ).toUpperCase() ===
                'PENDING'
            );

          }
        )
      : [];

  return `

    <div
      style="
        padding:10px;
      "
    >

      <h3
        style="
          margin-top:0;
          color:#166534;
        "
      >
        Patient Visit Complete
      </h3>

      ${opdField(
        'Patient',
        patient.full_name
      )}

      ${opdField(
        'Patient ID',
        patient.patient_id
      )}

      <div
        style="
          display:grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(
                160px,
                1fr
              )
            );
          gap:12px;
          margin-top:20px;
        "
      >

        ${opdField(
          'Total Services',
          totalAmount.toFixed(2)
        )}

        ${opdField(
          'Total Discounts',
          totalDiscount.toFixed(2)
        )}

        ${opdField(
          'Total Payable',
          totalPayable.toFixed(2)
        )}

        ${opdField(
          'Total Paid',
          totalPaid.toFixed(2)
        )}

        ${opdField(
          'Outstanding Balance',
          totalBalance.toFixed(2)
        )}

      </div>

      <div
        style="
          margin-top:25px;
          display:flex;
          flex-wrap:wrap;
          gap:12px;
          justify-content:center;
        "
        onclick="event.stopPropagation()"
      >

        <button
          type="button"
          class="btn btn-secondary"
          onclick="
            printOPDReceipt()
          "
        >
          Print Receipt
        </button>

        <button
          type="button"
          class="btn btn-secondary"
          onclick="
            printOPDMedicalJourney()
          "
        >
          Print Patient Medical Journey
        </button>

        <button
          type="button"
          class="btn btn-success"
          onclick="
            completeOPDPatient(this)
          "
        >
          Complete Patient Visit
        </button>

      </div>

      ${
        pendingOPDReferrals.length
          ? `

            <div
              style="
                margin-top:20px;
                padding:15px;
                border-radius:8px;
                background:#f0fdf4;
                color:#166534;
                text-align:center;
              "
            >

              This patient has an active OPD referral.

              Completing this visit will close the pending
              OPD referral and remove the patient
              from the active patient selection.

            </div>

          `
          : `

            <div
              style="
                margin-top:20px;
                padding:15px;
                border-radius:8px;
                background:#f8fafc;
                color:#64748b;
                text-align:center;
              "
            >

              No pending OPD referral was found.

            </div>

          `
      }

    </div>

  `;

}


// =========================================================
// OPD BILLING SAVE
// DATABASE IS THE SOURCE OF TRUTH
// PRESERVES CURRENT SLIDE
// =========================================================

function renderOPDBilling(
  billing,
  cardTitle,
  cardIndex
) {

  const rows =
    Array.isArray(
      billing
    )
      ? billing
      : [];

  let totalAmount =
    0;

  let totalDiscount =
    0;

  let totalPaid =
    0;

  let totalBalance =
    0;

  rows.forEach(
    function (
      bill
    ) {

      totalAmount +=
        Number(
          bill.amount || 0
        );

      totalDiscount +=
        Number(
          bill.discount || 0
        );

      totalPaid +=
        Number(
          bill.amount_paid || 0
        );

      totalBalance +=
        Number(
          bill.balance || 0
        );

    }
  );

  const totalPayable =
    Math.max(
      0,
      totalAmount -
      totalDiscount
    );

  return `

    <div
      class="opd-billing-section"
      style="
        margin-top:25px;
        padding:20px;
        border-top:2px solid #e2e8f0;
      "
      onclick="event.stopPropagation()"
    >

      <h4
        style="
          margin:0 0 15px 0;
        "
      >
        Finance & Billing
      </h4>

      ${opdField(
        'Billing Card',
        cardTitle
      )}

      <div
        style="
          display:grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(
                150px,
                1fr
              )
            );
          gap:12px;
          margin-top:15px;
          margin-bottom:18px;
        "
      >

        ${opdField(
          'Cumulative Bill',
          totalAmount.toFixed(2)
        )}

        ${opdField(
          'Cumulative Discount',
          totalDiscount.toFixed(2)
        )}

        ${opdField(
          'Total Payable',
          totalPayable.toFixed(2)
        )}

        ${opdField(
          'Cumulative Paid',
          totalPaid.toFixed(2)
        )}

        ${opdField(
          'Cumulative Balance',
          totalBalance.toFixed(2)
        )}

      </div>

      <div
        style="
          display:grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(
                160px,
                1fr
              )
            );
          gap:12px;
          align-items:end;
        "
      >

        <div>

          <label>
            Bill Amount
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            class="form-control opd-slide-bill"
            value="0"
          >

        </div>

        <div>

          <label>
            Discount / Waiver
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            class="form-control opd-slide-discount"
            value="0"
          >

        </div>

        <div>

          <label>
            Amount Paid
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            class="form-control opd-slide-paid"
            value="0"
          >

        </div>

        <div>

          <label>
            Payment Method
          </label>

          <select
            class="form-control opd-slide-payment-method"
          >

            <option value="Cash">
              Cash
            </option>

            <option value="Mobile Money">
              Mobile Money
            </option>

            <option value="Card">
              Card
            </option>

            <option value="Bank">
              Bank
            </option>

          </select>

        </div>

        <div>

          <button
            type="button"
            class="btn btn-primary"
            onclick="
              processOPDSlidePayment(
                this
              )
            "
          >
            Save Billing
          </button>

        </div>

      </div>

      <div
        style="
          margin-top:20px;
        "
      >

        <h5>
          Complete Billing History
        </h5>

        ${
          rows.length
            ? `

              <div
                style="
                  overflow-x:auto;
                "
              >

                <table
                  class="medical-report-table"
                >

                  <thead>

                    <tr>

                      <th>
                        Invoice
                      </th>

                      <th>
                        Date
                      </th>

                      <th>
                        Service
                      </th>

                      <th>
                        Amount
                      </th>

                      <th>
                        Discount
                      </th>

                      <th>
                        Total
                      </th>

                      <th>
                        Paid
                      </th>

                      <th>
                        Balance
                      </th>

                      <th>
                        Method
                      </th>

                      <th>
                        Status
                      </th>

                    </tr>

                  </thead>

                  <tbody>

                    ${
                      rows.map(
                        function (
                          bill
                        ) {

                          return `

                            <tr>

                              <td>
                                ${escapeHTML(
                                  bill.invoice_number ||
                                  '—'
                                )}
                              </td>

                              <td>
                                ${escapeHTML(
                                  bill.bill_date ||
                                  bill.created_at ||
                                  '—'
                                )}
                              </td>

                              <td>
                                ${escapeHTML(
                                  (bill.description || bill.service_type || 'Patient service').replace(/^OPD\b/i, 'Patient Visit')
                                )}
                              </td>

                              <td>
                                ${Number(
                                  bill.amount || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.discount || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.total_amount || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.amount_paid || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${Number(
                                  bill.balance || 0
                                ).toFixed(2)}
                              </td>

                              <td>
                                ${escapeHTML(
                                  bill.payment_method ||
                                  '—'
                                )}
                              </td>

                              <td>
                                ${escapeHTML(
                                  bill.payment_status ||
                                  bill.status ||
                                  '—'
                                )}
                              </td>

                            </tr>

                          `;

                        }
                      ).join('')
                    }

                  </tbody>

                </table>

              </div>

            `
            : `

              <div
                style="
                  color:#64748b;
                  padding:15px 0;
                "
              >
                No billing records have been saved yet.
              </div>

            `
        }

      </div>

    </div>

  `;

}

// =========================================================
// OPD BILLING SAVE / UPDATE
// ONE INVOICE PER OPD CARD
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

async function processOPDSlidePayment(
  button
) {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  if (
    !select ||
    !select.value
  ) {

    alert(
      'Please select a patient first.'
    );

    return;

  }

  const card =
    button.closest(
      '.opd-report-slide'
    );

  if (!card) {

    alert(
      'Billing card could not be found.'
    );

    return;

  }

  const patientId =
    Number(
      select.value
    );

  const amount =
    parseFloat(
      card.querySelector(
        '.opd-slide-bill'
      )?.value
    ) || 0;

  const discount =
    parseFloat(
      card.querySelector(
        '.opd-slide-discount'
      )?.value
    ) || 0;

  const requestedPaid =
    parseFloat(
      card.querySelector(
        '.opd-slide-paid'
      )?.value
    ) || 0;

  const paymentMethod =
    card.querySelector(
      '.opd-slide-payment-method'
    )?.value ||
    'Cash';

  const billingId =
    button.dataset.billingId
      ? Number(
          button.dataset.billingId
        )
      : null;

  const cardIndex =
    Number(
      card.dataset.slideIndex
    );

  if (
    !Number.isInteger(
      patientId
    )
  ) {

    alert(
      'Invalid patient selected.'
    );

    return;

  }

  if (
    amount <= 0
  ) {

    alert(
      'Enter a bill amount greater than zero.'
    );

    return;

  }

  if (
    discount < 0
  ) {

    alert(
      'Discount cannot be negative.'
    );

    return;

  }

  if (
    discount > amount
  ) {

    alert(
      'Discount cannot be greater than the bill amount.'
    );

    return;

  }

  const payable =
    Math.max(
      0,
      amount -
      discount
    );

  if (
    requestedPaid < 0
  ) {

    alert(
      'Amount paid cannot be negative.'
    );

    return;

  }

  if (
    requestedPaid > payable
  ) {

    alert(
      'Amount paid cannot be greater than the bill total.'
    );

    return;

  }

  button.disabled =
    true;

  try {

    /*
     * -------------------------------------------------------
     * GET CURRENT DATABASE BILLING FIRST
     * -------------------------------------------------------
     *
     * This prevents the browser from guessing
     * the existing amount already paid.
     */

    const currentBillingResponse =
      await fetch(
        `/api/billing/patient/${encodeURIComponent(patientId)}`,
        {
          method:
            'GET',

          credentials:
            'same-origin',

          cache:
            'no-store',

          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const currentBillingData =
      await currentBillingResponse
        .json()
        .catch(
          function () {
            return {};
          }
        );

    if (
      !currentBillingResponse.ok
    ) {

      throw new Error(
        'Unable to load the current billing record.'
      );

    }

    const currentRows =
      Array.isArray(
        currentBillingData.billings
      )
        ? currentBillingData.billings
        : (
            Array.isArray(
              currentBillingData.billing
            )
              ? currentBillingData.billing
              : []
          );

    /*
     * -------------------------------------------------------
     * LOCATE THE BILL BELONGING TO THIS CARD
     * -------------------------------------------------------
     */

    let existingBill =
      null;

    if (
      billingId
    ) {

      existingBill =
        currentRows.find(
          function (
            bill
          ) {

            return (
              Number(
                bill.id
              ) ===
              billingId
            );

          }
        ) || null;

    }

    if (
      !existingBill
    ) {

      const expectedDescription =
        `Patient Visit - Card ${cardIndex + 1}`;

      const legacyDescription =
        `OPD - ${cardIndex + 1}`;

      existingBill =
        currentRows.find(
          function (
            bill
          ) {

            const description =
              String(
                bill.description ||
                ''
              ).trim();

            return (
              description ===
                expectedDescription ||
              description ===
                legacyDescription
            );

          }
        ) || null;

    }

    const actualBillingId =
      existingBill
        ? existingBill.id
        : null;

    const previousPaid =
      existingBill
        ? Number(
            existingBill.amount_paid || 0
          )
        : 0;

    /*
     * The user is entering the DESIRED
     * total paid for this invoice.
     *
     * We therefore only send the difference
     * to the payment endpoint.
     */

    const additionalPayment =
      requestedPaid -
      previousPaid;

    if (
      additionalPayment < 0
    ) {

      alert(
        'The new amount paid is lower than the amount already recorded. Existing payments cannot be reduced from this screen.'
      );

      return;

    }

    /*
     * -------------------------------------------------------
     * CREATE OR UPDATE BILL
     * -------------------------------------------------------
     */

    const billPayload = {

      patient_id:
        patientId,

      amount:
        amount,

      discount:
        discount,

      description:
        `Patient Visit - Card ${cardIndex + 1}`,

      service_type:
        'OPD'

    };

    if (
      actualBillingId
    ) {

      billPayload.billing_id =
        actualBillingId;

    }

    const billResponse =
      await fetch(
        '/api/billing/bill',
        {
          method:
            'POST',

          credentials:
            'same-origin',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify(
              billPayload
            )
        }
      );

    const billData =
      await billResponse
        .json()
        .catch(
          function () {
            return {};
          }
        );

    if (
      !billResponse.ok ||
      billData.success === false
    ) {

      throw new Error(
        billData.error ||
        billData.message ||
        'Failed to save OPD billing.'
      );

    }

    const savedBilling =
      billData.billing ||
      null;

    const savedBillingId =
      savedBilling
        ? savedBilling.id
        : (
            billData.billing_id ||
            billData.id ||
            actualBillingId
          );

    /*
     * -------------------------------------------------------
     * PROCESS ONLY NEW PAYMENT
     * -------------------------------------------------------
     */

    if (
      additionalPayment > 0
    ) {

      if (
        !savedBillingId
      ) {

        throw new Error(
          'Billing was saved but its database ID could not be determined.'
        );

      }

      const paymentResponse =
        await fetch(
          '/api/billing/payment',
          {
            method:
              'POST',

            credentials:
              'same-origin',

            headers: {
              'Content-Type':
                'application/json',

              'Accept':
                'application/json'
            },

            body:
              JSON.stringify(
                {
                  billing_id:
                    savedBillingId,

                  patient_id:
                    patientId,

                  amount:
                    additionalPayment,

                  payment_method:
                    paymentMethod
                }
              )
          }
        );

      const paymentData =
        await paymentResponse
          .json()
          .catch(
            function () {
              return {};
            }
          );

      if (
        !paymentResponse.ok ||
        paymentData.success === false
      ) {

        throw new Error(
          paymentData.error ||
          paymentData.message ||
          'Billing was updated but the payment could not be recorded.'
        );

      }

    }

    /*
     * -------------------------------------------------------
     * KEEP THE SAME CARD
     * -------------------------------------------------------
     */

    window.currentOPDReportSlide =
      cardIndex;

    /*
     * -------------------------------------------------------
     * RELOAD EVERYTHING FROM POSTGRESQL
     * -------------------------------------------------------
     */

    await loadMedicalReportPatient();

  }

  catch (
    error
  ) {

    console.error(
      'OPD BILLING SAVE ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to save OPD billing.'
    );

  }

  finally {

    button.disabled =
      false;

  }

}

async function printOPDReceipt() {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  if (
    !select ||
    !select.value
  ) {

    alert(
      'Please select a patient first.'
    );

    return;

  }

  const patientId =
    Number(
      select.value
    );

  if (
    !Number.isInteger(
      patientId
    )
  ) {

    alert(
      'Invalid patient selected.'
    );

    return;

  }

  /*
   * Open immediately so the browser
   * does not block the print window.
   */

  const printWindow =
    window.open(
      '',
      '_blank',
      'width=900,height=800'
    );

  if (!printWindow) {

    alert(
      'Please allow pop-ups for the HMS application.'
    );

    return;

  }

  printWindow.document.write(`
    <html>

      <head>

        <title>
          OPD Receipt
        </title>

        <style>

          body {
            font-family:
              Arial,
              sans-serif;

            padding:30px;

            color:#111827;
          }

          h1,
          h2,
          h3 {
            margin-top:0;
          }

          .header {
            text-align:center;
            margin-bottom:30px;
          }

          .patient {
            border:1px solid #d1d5db;
            padding:15px;
            margin-bottom:20px;
          }

          table {
            width:100%;
            border-collapse:collapse;
            margin-top:20px;
          }

          th,
          td {
            border:1px solid #d1d5db;
            padding:9px;
            text-align:left;
          }

          th {
            background:#f3f4f6;
          }

          .totals {
            margin-top:25px;
            margin-left:auto;
            max-width:350px;
          }

          .total-row {
            display:flex;
            justify-content:space-between;
            padding:7px 0;
          }

          .grand-total {
            font-weight:bold;
            font-size:18px;
            border-top:2px solid #111827;
            padding-top:10px;
          }

          .footer {
            margin-top:40px;
            text-align:center;
            color:#6b7280;
            font-size:12px;
          }

          @media print {

            body {
              padding:10px;
            }

          }

        </style>

      </head>

      <body>

        Loading receipt...

      </body>

    </html>
  `);

  printWindow.document.close();

  try {

    /*
     * DATABASE IS THE SOURCE OF TRUTH.
     * Do not use the currently displayed
     * slide values for the receipt.
     */

    const response =
      await fetch(
        `/api/opd/patient/${encodeURIComponent(patientId)}`,
        {
          method:
            'GET',

          credentials:
            'same-origin',

          cache:
            'no-store',

          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await response
        .json();

    if (
      !response.ok ||
      data.success === false
    ) {

      throw new Error(
        data.message ||
        data.error ||
        'Unable to load patient billing information.'
      );

    }

    const patient =
      data.patient ||
      {};

    const billing =
      Array.isArray(
        data.billing
      )
        ? data.billing
        : [];

    let totalAmount =
      0;

    let totalDiscount =
      0;

    let totalPaid =
      0;

    let totalBalance =
      0;

    billing.forEach(
      function (
        bill
      ) {

        totalAmount +=
          Number(
            bill.amount || 0
          );

        totalDiscount +=
          Number(
            bill.discount || 0
          );

        totalPaid +=
          Number(
            bill.amount_paid || 0
          );

        totalBalance +=
          Number(
            bill.balance || 0
          );

      }
    );

    const totalPayable =
      Math.max(
        0,
        totalAmount -
        totalDiscount
      );

    const rows =
      billing.length
        ? billing.map(
            function (
              bill
            ) {

              return `

                <tr>

                  <td>
                    ${escapeHTML(
                      bill.invoice_number ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${escapeHTML(
                      (bill.description || bill.service_type || 'Patient service').replace(/^OPD\b/i, 'Patient Visit')
                    )}
                  </td>

                  <td>
                    ${Number(
                      bill.amount || 0
                    ).toFixed(2)}
                  </td>

                  <td>
                    ${Number(
                      bill.discount || 0
                    ).toFixed(2)}
                  </td>

                  <td>
                    ${Number(
                      bill.total_amount || 0
                    ).toFixed(2)}
                  </td>

                  <td>
                    ${Number(
                      bill.amount_paid || 0
                    ).toFixed(2)}
                  </td>

                  <td>
                    ${Number(
                      bill.balance || 0
                    ).toFixed(2)}
                  </td>

                  <td>
                    ${escapeHTML(
                      bill.payment_method ||
                      '—'
                    )}
                  </td>

                </tr>

              `;

            }
          ).join('')
        : `

          <tr>

            <td
              colspan="8"
              style="text-align:center;"
            >
              No billing records found.
            </td>

          </tr>

        `;

    printWindow.document.body.innerHTML = `

      <div class="header">

        <h1>
          OPD PAYMENT RECEIPT
        </h1>

        <div>
          Hospital Management System
        </div>

      </div>

      <div class="patient">

        <strong>
          Patient:
        </strong>

        ${escapeHTML(
          patient.full_name ||
          '—'
        )}

        <br>

        <strong>
          Patient ID:
        </strong>

        ${escapeHTML(
          patient.patient_id ||
          patient.id ||
          '—'
        )}

        <br>

        <strong>
          Printed:
        </strong>

        ${escapeHTML(
          new Date().toLocaleString()
        )}

      </div>

      <h3>
        Billing Records
      </h3>

      <table>

        <thead>

          <tr>

            <th>
              Invoice
            </th>

            <th>
              Service
            </th>

            <th>
              Amount
            </th>

            <th>
              Discount
            </th>

            <th>
              Total
            </th>

            <th>
              Paid
            </th>

            <th>
              Balance
            </th>

            <th>
              Method
            </th>

          </tr>

        </thead>

        <tbody>

          ${rows}

        </tbody>

      </table>

      <div class="totals">

        <div class="total-row">

          <span>
            Total Bill
          </span>

          <strong>
            ${totalAmount.toFixed(2)}
          </strong>

        </div>

        <div class="total-row">

          <span>
            Total Discount
          </span>

          <strong>
            ${totalDiscount.toFixed(2)}
          </strong>

        </div>

        <div class="total-row grand-total">

          <span>
            Total Payable
          </span>

          <strong>
            ${totalPayable.toFixed(2)}
          </strong>

        </div>

        <div class="total-row">

          <span>
            Total Paid
          </span>

          <strong>
            ${totalPaid.toFixed(2)}
          </strong>

        </div>

        <div class="total-row">

          <span>
            Outstanding Balance
          </span>

          <strong>
            ${totalBalance.toFixed(2)}
          </strong>

        </div>

      </div>

      <div class="footer">

        OPD billing information retrieved
        from the hospital database.

      </div>

    `;

    printWindow.focus();

    printWindow.print();

  }

  catch (
    error
  ) {

    printWindow.document.body.innerHTML = `

      <h3>
        Unable to print receipt
      </h3>

      <p>
        ${escapeHTML(
          error.message ||
          'Unknown error'
        )}
      </p>

    `;

    console.error(
      'OPD RECEIPT ERROR:',
      error
    );

  }

}

async function printOPDMedicalJourney() {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  if (
    !select ||
    !select.value
  ) {

    alert(
      'Please select a patient first.'
    );

    return;

  }

  const patientId =
    Number(
      select.value
    );

  if (
    !Number.isInteger(
      patientId
    )
  ) {

    alert(
      'Invalid patient selected.'
    );

    return;

  }

  const printWindow =
    window.open(
      '',
      '_blank',
      'width=1100,height=900'
    );

  if (!printWindow) {

    alert(
      'Please allow pop-ups for the HMS application.'
    );

    return;

  }

  printWindow.document.write(`

    <html>

      <head>

        <title>
          Patient Medical Journey
        </title>

        <style>

          @page {
            size:
              A4
              portrait;

            margin:
              12mm;
          }

          * {
            box-sizing:
              border-box;
          }

          html,
          body {
            width:
              100%;

            margin:
              0;

            padding:
              0;
          }

          body {
            font-family:
              Arial,
              Helvetica,
              sans-serif;

            color:
              #111827;

            background:
              #ffffff;

            font-size:
              12px;

            line-height:
              1.45;

            padding:
              15px;
          }

          .journey-header {
            text-align:
              center;

            margin-bottom:
              25px;

            padding-bottom:
              15px;

            border-bottom:
              2px solid #1f2937;
          }

          .journey-header h1 {
            margin:
              0 0 8px 0;

            font-size:
              22px;

            font-weight:
              700;
          }

          .journey-header h2 {
            margin:
              0 0 6px 0;

            font-size:
              17px;

            font-weight:
              700;
          }

          .journey-header div {
            margin-top:
              3px;

            font-size:
              11px;
          }

          .journey-card {
            width:
              100%;

            margin-bottom:
              22px;

            border:
              1px solid #cbd5e1;

            border-radius:
              6px;

            background:
              #ffffff;

            overflow:
              visible;

            page-break-inside:
              auto;

            break-inside:
              auto;
          }

          .journey-card-header {
            padding:
              10px 12px;

            background:
              #f1f5f9;

            border-bottom:
              1px solid #cbd5e1;

            font-weight:
              700;

            font-size:
              15px;

            page-break-after:
              avoid;

            break-after:
              avoid;
          }

          .journey-card-body {
            padding:
              12px;

            width:
              100%;

            overflow:
              visible;
          }

          .opd-record-grid {
            display:
              grid;

            grid-template-columns:
              repeat(
                2,
                minmax(
                  0,
                  1fr
                )
              );

            gap:
              10px;

            width:
              100%;
          }

          .journey-print-field {
            width:
              100%;

            min-width:
              0;

            padding:
              8px;

            border:
              1px solid #e2e8f0;

            border-radius:
              5px;

            overflow-wrap:
              anywhere;

            word-break:
              break-word;
          }

          .journey-print-label {
            margin-bottom:
              3px;

            font-size:
              9px;

            font-weight:
              700;

            color:
              #64748b;
          }

          .journey-print-value {
            font-size:
              11px;

            white-space:
              pre-wrap;

            overflow-wrap:
              anywhere;

            word-break:
              break-word;
          }

          /*
           * TABLE PRINTING
           */

          table {
            width:
              100%;

            max-width:
              100%;

            border-collapse:
              collapse;

            border-spacing:
              0;

            table-layout:
              auto;

            margin:
              8px 0 15px 0;

            font-size:
              10px;
          }

          thead {
            display:
              table-header-group;
          }

          tbody {
            display:
              table-row-group;
          }

          tfoot {
            display:
              table-footer-group;
          }

          tr {
            page-break-inside:
              avoid;

            break-inside:
              avoid;
          }

          th,
          td {
            border:
              1px solid #cbd5e1;

            padding:
              6px;

            text-align:
              left;

            vertical-align:
              top;

            white-space:
              normal;

            overflow-wrap:
              anywhere;

            word-break:
              break-word;

            line-height:
              1.35;
          }

          th {
            background:
              #f1f5f9;

            font-weight:
              700;

            color:
              #111827;
          }

          td {
            color:
              #111827;
          }

          /*
           * Prevent very long IDs,
           * descriptions and results
           * from forcing the page wider.
           */

          td *,
          th * {
            max-width:
              100%;

            overflow-wrap:
              anywhere;

            word-break:
              break-word;
          }

          /*
           * Containers around tables must
           * not create horizontal scrolling
           * in the printed document.
           */

          .journey-card-body > div {
            max-width:
              100%;

            overflow:
              visible;
          }

          .journey-card-body > div[style*="overflow"] {
            overflow:
              visible !important;
          }

          /*
           * Keep headings with the content
           * immediately below them.
           */

          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {
            page-break-after:
              avoid;

            break-after:
              avoid;
          }

          /*
           * Images must remain inside
           * the printable page.
           */

          img {
            max-width:
              100%;

            height:
              auto;
          }

          /*
           * Do not print interactive controls.
           */

          button,
          input,
          select,
          textarea,
          a {
            display:
              none !important;
          }

          /*
           * Print-friendly spacing.
           */

          p {
            overflow-wrap:
              anywhere;

            word-break:
              break-word;
          }

          @media print {

            html,
            body {
              width:
                100%;

              margin:
                0;

              padding:
                0;
            }

            body {
              font-size:
                10px;
            }

            .journey-header {
              margin-bottom:
                18px;

              padding-bottom:
                10px;
            }

            .journey-header h1 {
              font-size:
                18px;
            }

            .journey-header h2 {
              font-size:
                14px;
            }

            .journey-card {
              margin-bottom:
                16px;

              border-radius:
                4px;
            }

            .journey-card-header {
              padding:
                7px 9px;

              font-size:
                12px;
            }

            .journey-card-body {
              padding:
                9px;
            }

            .opd-record-grid {
              gap:
                7px;
            }

            .journey-print-field {
              padding:
                6px;
            }

            .journey-print-label {
              font-size:
                8px;
            }

            .journey-print-value {
              font-size:
                9px;
            }

            table {
              font-size:
                8.5px;

              margin:
                6px 0 10px 0;
            }

            th,
            td {
              padding:
                4px;
            }

            /*
             * Registration / Visits and other
             * tables are allowed to continue
             * onto another page when necessary,
             * but individual rows stay together.
             */

            .journey-card table {
              page-break-inside:
                auto;

              break-inside:
                auto;
            }

            .journey-card table tr {
              page-break-inside:
                avoid;

              break-inside:
                avoid;
            }

          }

        </style>

      </head>

      <body>

        Loading medical journey...

      </body>

    </html>

  `);

  printWindow.document.close();

  try {

    /*
     * DATABASE IS THE SOURCE OF TRUTH.
     *
     * Always reload the complete OPD
     * record from the database before
     * creating the printable document.
     */

    const response =
      await fetch(
        `/api/opd/patient/${encodeURIComponent(patientId)}`,
        {
          method:
            'GET',

          credentials:
            'same-origin',

          cache:
            'no-store',

          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await response
        .json();

    if (
      !response.ok ||
      data.success === false
    ) {

      throw new Error(
        data.message ||
        data.error ||
        'Unable to load the patient medical journey.'
      );

    }

    const patient =
      data.patient ||
      {};

    const registration =
      data.registration ||
      {};

    const visits =
      Array.isArray(
        registration.visits
      )
        ? registration.visits
        : [];

    const triage =
      Array.isArray(
        data.triage
      )
        ? data.triage
        : [];

    const reports =
      data.reports ||
      {};

    const referrals =
      Array.isArray(
        data.referrals
      )
        ? data.referrals
        : [];

    /*
     * These are the actual medical
     * sections of the OPD journey.
     *
     * BILLING IS INTENTIONALLY NOT
     * INCLUDED IN THIS PRINT.
     */

    const cards = [

      {
        title:
          'Patient Information',

        icon:
          '👤',

        content:
          renderOPDPatientInformation(
            patient
          )
      },

      {
        title:
          'Registration / Visits',

        icon:
          '📋',

        content:
          renderOPDRegistrationRecords(
            visits
          )
      },

      {
        title:
          'Triage Record',

        icon:
          '🩺',

        content:
          renderOPDTriageRecord(
            triage
          )
      },

      {
        title:
          'Doctor Consultation Record',

        icon:
          '👨‍⚕️',

        content:
          renderOPDDoctorRecord(
            reports.doctor
          )
      },

      {
        title:
          'Pharmacy Record',

        icon:
          '💊',

        content:
          renderOPDPharmacyRecord(
            reports.pharmacy
          )
      },

      {
        title:
          'Laboratory Record',

        icon:
          '🧪',

        content:
          renderOPDLaboratoryRecord(
            reports.laboratory
          )
      },

      {
        title:
          'Radiology Record',

        icon:
          '🩻',

        content:
          renderOPDRadiologyRecord(
            reports.radiology
          )
      },

      {
        title:
          'Operating Theatre Record',

        icon:
          '🏥',

        content:
          renderOPDTheatreRecord(
            reports.theatre
          )
      },

      {
        title:
          'Nursing Record',

        icon:
          '👩‍⚕️',

        content:
          renderOPDNursingRecord(
            reports.nursing
          )
      },

      {
        title:
          'Referral History',

        icon:
          '🔄',

        content:
          renderOPDReferralRecords(
            referrals
          )
      }

    ];

    /*
     * Build the printable document.
     */

    printWindow.document.body.innerHTML = `

      <div
        class="journey-header"
      >

        <h1>
          PATIENT MEDICAL JOURNEY
        </h1>

        <h2>
          ${escapeHTML(
            patient.full_name ||
            '—'
          )}
        </h2>

        <div>
          <strong>
            Patient ID:
          </strong>

          ${escapeHTML(
            patient.patient_id ||
            patient.id ||
            '—'
          )}
        </div>

        <div>
          <strong>
            Printed:
          </strong>

          ${escapeHTML(
            new Date().toLocaleString()
          )}
        </div>

      </div>

      ${cards.map(
        function (
          card
        ) {

          return `

            <section
              class="journey-card"
            >

              <div
                class="journey-card-header"
              >

                ${card.icon}

                ${escapeHTML(
                  card.title
                )}

              </div>

              <div
                class="journey-card-body"
              >

                ${
                  card.content ||
                  `
                    <div>
                      No records available.
                    </div>
                  `
                }

              </div>

            </section>

          `;

        }
      ).join('')}

    `;

    /*
     * Remove interactive elements from
     * the rendered medical cards.
     */

    const interactiveElements =
      printWindow.document.querySelectorAll(
        'button, input, select, textarea, a'
      );

    interactiveElements.forEach(
      function (
        element
      ) {

        element.remove();

      }
    );

    /*
     * Make sure tables use the printable
     * layout even if their original
     * application CSS contains
     * horizontal scrolling.
     */

    const tables =
      printWindow.document.querySelectorAll(
        'table'
      );

    tables.forEach(
      function (
        table
      ) {

        table.style.width =
          '100%';

        table.style.maxWidth =
          '100%';

        table.style.tableLayout =
          'auto';

        table.style.borderCollapse =
          'collapse';

        table.style.whiteSpace =
          'normal';

        table.style.overflow =
          'visible';

      }
    );

    const tableCells =
      printWindow.document.querySelectorAll(
        'table th, table td'
      );

    tableCells.forEach(
      function (
        cell
      ) {

        cell.style.whiteSpace =
          'normal';

        cell.style.wordBreak =
          'break-word';

        cell.style.overflowWrap =
          'anywhere';

        cell.style.verticalAlign =
          'top';

      }
    );

    /*
     * Give the browser one rendering
     * cycle before starting printing.
     * This prevents partially-rendered
     * tables/cards from being printed.
     */

    await new Promise(
      function (
        resolve
      ) {

        printWindow.requestAnimationFrame(
          function () {

            printWindow.requestAnimationFrame(
              function () {

                resolve();

              }
            );

          }
        );

      }
    );

    /*
     * Close the print window after the
     * browser finishes printing.
     */

    printWindow.onafterprint =
      function () {

        try {

          printWindow.close();

        }

        catch (
          closeError
        ) {

          console.warn(
            'Unable to close print window:',
            closeError
          );

        }

      };

    printWindow.focus();

    printWindow.print();

  }

  catch (
    error
  ) {

    console.error(
      'OPD MEDICAL JOURNEY PRINT ERROR:',
      error
    );

    printWindow.document.body.innerHTML = `

      <div
        style="
          font-family:Arial,sans-serif;
          padding:30px;
        "
      >

        <h3>
          Unable to print medical journey
        </h3>

        <p>
          ${escapeHTML(
            error.message ||
            'Unknown error'
          )}
        </p>

      </div>

    `;

  }

}

// =========================================================
// VIEW STORED REPORT
// =========================================================

function viewStoredMedicalReport(
  reportId
) {

  const report =
    state.generatedReports.find(
      item =>
        item.id === reportId
    );

  if (!report) {

    alert(
      'Report could not be found.'
    );

    return;

  }

  renderMedicalReport(
    report
  );

  const preview =
    document.getElementById(
      'medical-report-preview'
    );

  if (preview) {

    preview.scrollIntoView({
      behavior:
        'smooth'
    });

  }

}

// =========================================================
// RENDER MEDICAL REPORT
// =========================================================

function renderMedicalReport(
  report
) {

  const container =
    document.getElementById(
      'medical-report-preview'
    );

  if (!container) return;

  container.innerHTML = `

    <div class="medical-report-document">

      <div class="medical-report-header">

        <div>

          <div class="medical-report-title">
            MEDICAL REPORT
          </div>

          <div class="medical-report-subtitle">
            ${escapeHTML(
              state.settings.hospitalName
            )}
          </div>

        </div>

        <div class="medical-report-meta">

          <strong>
            Report No:
          </strong>

          ${escapeHTML(report.id)}

          <br>

          <strong>
            Generated:
          </strong>

          ${escapeHTML(report.generatedAt)}

        </div>

      </div>

      <div class="medical-report-patient-banner">

        <strong>
          ${escapeHTML(report.patientName)}
        </strong>

        <span>
          Patient ID:
          ${escapeHTML(report.patientId)}
        </span>

      </div>

      ${report.sections
        .map(
          section => `

            <section
              class="medical-report-section"
            >

              <h4>
                ${escapeHTML(section.title)}
              </h4>

              <div class="medical-report-table-wrap">

                <table
                  class="medical-report-table"
                >

                  <tbody>

                    ${section.rows
                      .map(
                        row => `

                          <tr>

                            <th>
                              ${escapeHTML(row[0])}
                            </th>

                            <td>
                              ${formatReportValue(
                                row[1]
                              )}
                            </td>

                          </tr>

                        `
                      )
                      .join('')}

                  </tbody>

                </table>

              </div>

            </section>

          `
        )
        .join('')}

      <div class="medical-report-footer">

        <span>

          Report Type:
          ${escapeHTML(
            report.reportType
          )}

        </span>

        <span>

          Generated from
          patient encounter records.

        </span>

      </div>

      <div class="medical-report-actions">

        <button
          type="button"
          class="btn btn-primary"
          onclick="
            printMedicalReport(
              '${escapeHTML(report.id)}'
            )
          "
        >
          🖨️ Print Report
        </button>

        <button
          type="button"
          class="btn btn-secondary"
          onclick="
            downloadMedicalReportJSON(
              '${escapeHTML(report.id)}'
            )
          "
        >
          💾 Save Report Data
        </button>

      </div>

    </div>

  `;

}

// =========================================================
// PRINT MEDICAL REPORT
// =========================================================

function printMedicalReport(
  reportId = null
) {

  let report =
    reportId
      ? state.generatedReports.find(
          item =>
            item.id === reportId
        )
      : null;

  let preview =
    document.getElementById(
      'medical-report-preview'
    );

  if (report) {

    const temp =
      document.createElement(
        'div'
      );

    temp.innerHTML =
      preview
        ? preview.innerHTML
        : '';

    /*
     * If the preview does not belong to the requested
     * report, render the requested report temporarily.
     */

    if (
      !preview ||
      !preview.innerHTML.includes(
        report.id
      )
    ) {

      renderMedicalReport(
        report
      );

      preview =
        document.getElementById(
          'medical-report-preview'
        );

    }

  }

  if (!preview) {

    alert(
      'No medical report is available to print.'
    );

    return;

  }

  const printWindow =
    window.open(
      '',
      '_blank'
    );

  if (!printWindow) {

    alert(
      'Please allow pop-ups to print the report.'
    );

    return;

  }

  printWindow.document.write(`

    <!DOCTYPE html>

    <html>

      <head>

        <meta charset="UTF-8">

        <title>
          Medical Report
        </title>

        <style>

          * {
            box-sizing:
              border-box;
          }

          body {

            font-family:
              Arial,
              Helvetica,
              sans-serif;

            margin:
              30px;

            color:
              #111827;

            background:
              white;

          }

          .medical-report-header {

            display:
              flex;

            justify-content:
              space-between;

            border-bottom:
              2px solid #111827;

            padding-bottom:
              15px;

            margin-bottom:
              20px;

          }

          .medical-report-title {

            font-size:
              24px;

            font-weight:
              800;

          }

          .medical-report-subtitle {

            color:
              #64748b;

            margin-top:
              5px;

          }

          .medical-report-meta {

            text-align:
              right;

            font-size:
              12px;

            line-height:
              1.8;

          }

          .medical-report-patient-banner {

            padding:
              12px;

            background:
              #f1f5f9;

            border:
              1px solid #cbd5e1;

            margin-bottom:
              20px;

          }

          .medical-report-patient-banner strong {

            display:
              block;

            font-size:
              18px;

            margin-bottom:
              4px;

          }

          .medical-report-section {

            margin-bottom:
              20px;

            page-break-inside:
              avoid;

          }

          .medical-report-section h4 {

            margin:
              0;

            padding:
              10px;

            background:
              #e2e8f0;

            border:
              1px solid #cbd5e1;

            font-size:
              14px;

          }

          .medical-report-table {

            width:
              100%;

            border-collapse:
              collapse;

          }

          .medical-report-table th,
          .medical-report-table td {

            border:
              1px solid #cbd5e1;

            padding:
              8px;

            text-align:
              left;

            vertical-align:
              top;

          }

          .medical-report-table th {

            width:
              30%;

            background:
              #f8fafc;

          }

          .medical-report-footer {

            margin-top:
              25px;

            padding-top:
              10px;

            border-top:
              1px solid #cbd5e1;

            display:
              flex;

            justify-content:
              space-between;

            font-size:
              11px;

            color:
              #64748b;

          }

          .medical-report-actions {

            display:
              none !important;

          }

          @media print {

            body {
              margin:
                15mm;
            }

          }

        </style>

      </head>

      <body>

        ${preview.innerHTML}

        <script>

          window.onload = function() {

            window.print();

            setTimeout(
              function() {
                window.close();
              },
              500
            );

          };

        <\/script>

      </body>

    </html>

  `);

  printWindow.document.close();

}

// =========================================================
// DOWNLOAD MEDICAL REPORT JSON
// =========================================================

function downloadMedicalReportJSON(
  reportId
) {

  const report =
    state.generatedReports.find(
      item =>
        item.id === reportId
    );

  if (!report) {

    alert(
      'Report data could not be found.'
    );

    return;

  }

  const json =
    JSON.stringify(
      report,
      null,
      2
    );

  const blob =
    new Blob(
      [json],
      {
        type:
          'application/json'
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const anchor =
    document.createElement(
      'a'
    );

  anchor.href =
    url;

  anchor.download =
    `${report.id}.json`;

  document.body.appendChild(
    anchor
  );

  anchor.click();

  anchor.remove();

  URL.revokeObjectURL(
    url
  );

}

// =========================================================
// ADMINISTRATION — PATIENT MANAGEMENT
// DATABASE-BACKED
// =========================================================

var adminPatients = [];
var adminSelectedPatient = null;

// =========================================================
// LOAD PATIENTS FROM DATABASE
// =========================================================

async function loadAdminPatients() {

    const select =
        document.getElementById(
            'admin-pt-select'
        );

    if (!select) {
        return;
    }

    select.innerHTML = `
        <option value="">
            Loading patients...
        </option>
    `;

    try {

        const response =
            await fetch(
                '/api/admin/patients',
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        'Accept':
                            'application/json'
                    }
                }
            );

        const data =
            await response.json()
                .catch(() => ({}));

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.error ||
                'Unable to load patient records.'
            );

        }

        adminPatients =
            Array.isArray(data.patients)
                ? data.patients
                : [];

        select.innerHTML = `
            <option value="">
                Select Patient
            </option>
        `;

        adminPatients.forEach(
            patient => {

                const option =
                    document.createElement(
                        'option'
                    );

                /*
                 * Use the database ID internally.
                 */

                option.value =
                    String(patient.id);

                /*
                 * Display the human-readable
                 * Patient ID and name.
                 */

                option.textContent =
                    `${patient.patient_id} — ${patient.full_name}`;

                select.appendChild(
                    option
                );

            }
        );

        if (
            adminSelectedPatient &&
            adminSelectedPatient.id
        ) {

            const exists =
                Array.from(
                    select.options
                ).some(
                    option =>
                        option.value ===
                        String(
                            adminSelectedPatient.id
                        )
                );

            if (exists) {

                select.value =
                    String(
                        adminSelectedPatient.id
                    );

            }

        }

    } catch (error) {

        console.error(
            'ADMIN PATIENT LOAD ERROR:',
            error
        );

        select.innerHTML = `
            <option value="">
                Unable to load patients
            </option>
        `;

        adminPatients = [];

        adminSelectedPatient = null;

        alert(
            error.message ||
            'Unable to load patient records.'
        );

    }

}

// =========================================================
// LOAD ONE PATIENT
// =========================================================

async function loadAdminPtData() {

    const select =
        document.getElementById(
            'admin-pt-select'
        );

    if (!select) {
        return;
    }

    const patientId =
        select.value;

    if (!patientId) {

        clearAdminPatientForm();

        return;
    }

    try {

        const response =
            await fetch(
                `/api/admin/patients/${encodeURIComponent(patientId)}`,
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        'Accept':
                            'application/json'
                    }
                }
            );

        const data =
            await response.json()
                .catch(() => ({}));

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.error ||
                'Unable to load patient.'
            );

        }

        adminSelectedPatient =
            data.patient;

        setInputValue(
            'adm-pt-id',
            adminSelectedPatient.patient_id
        );

        setInputValue(
            'adm-pt-name',
            adminSelectedPatient.full_name
        );

        setInputValue(
            'adm-pt-dob',
            adminSelectedPatient.date_of_birth
        );

        setInputValue(
            'adm-pt-gender',
            adminSelectedPatient.gender
        );

        setInputValue(
            'adm-pt-phone',
            adminSelectedPatient.phone
        );

        setInputValue(
            'adm-pt-national-id',
            adminSelectedPatient.national_id || ''
        );

        setInputValue(
            'adm-pt-status',
            adminSelectedPatient.status
        );

        setInputValue(
            'adm-merge-primary',
            adminSelectedPatient.patient_id
        );

    } catch (error) {

        console.error(
            'ADMIN PATIENT DETAILS ERROR:',
            error
        );

        clearAdminPatientForm();

        alert(
            error.message ||
            'Unable to load patient details.'
        );

    }

}

// =========================================================
// LOAD OPD PATIENTS FROM DATABASE
// DATABASE IS THE ONLY SOURCE OF TRUTH
// =========================================================

async function loadOPDPatients() {

  /*
   * IMPORTANT:
   *
   * The valid backend endpoint is:
   *
   *     GET /api/opd/patients
   *
   * NOT:
   *
   *     /api/opd/queue
   *
   * Keep this function because switchModule()
   * already calls loadOPDPatients().
   *
   * It now delegates to the correct database-backed
   * OPD patient selector loader.
   */

  return loadOPDPatientSelector();

}

// =========================================================
// HANDLE OPD PATIENT SELECTION CHANGE
// =========================================================

async function handleOPDPatientChange() {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  if (!select) {
    return;
  }

  const patientId =
    String(
      select.value || ''
    ).trim();

  if (!patientId) {

    window.currentOPDPatientData =
      null;

    window.currentOPDPatientId =
      null;

    window.currentOPDReportSlide =
      0;

    const container =
      document.getElementById(
        'medical-reports-list'
      );

    if (container) {

      container.innerHTML = `
        <div
          style="
            min-height:520px;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            padding:40px;
            color:#64748b;
          "
        >
          <div>
            <h3
              style="
                margin:0 0 10px 0;
                color:#334155;
              "
            >
              Finance Patient Records
            </h3>

            <p style="margin:0;">
              Select a patient above to view account and billing records.
            </p>
          </div>
        </div>
      `;

    }

    return;
  }

  /*
   * The complete OPD patient journey,
   * clinical records and billing cards
   * are rendered by loadMedicalReportPatient().
   */

  await loadMedicalReportPatient();

}

function renderOPDPatientDetails(patient) {
  // Update fields on the OPD page if elements exist
  setReceptionCardText('opd-card-id', patient.patient_id || '');
  setReceptionCardText('opd-card-name', patient.full_name || patient.name || '');
  setReceptionCardText('opd-card-gender', patient.gender || '');
  setReceptionCardText('opd-card-phone', patient.phone || '');
  
  // Save active OPD patient in state
  if (typeof state !== 'undefined') {
    state.activeOPDPatient = patient;
  }
}

function clearOPDPatientDetails() {
  setReceptionCardText('opd-card-id', '');
  setReceptionCardText('opd-card-name', '');
  setReceptionCardText('opd-card-gender', '');
  setReceptionCardText('opd-card-phone', '');

  if (typeof state !== 'undefined') {
    state.activeOPDPatient = null;
  }
}

// =========================================================
// LOAD OPD PATIENT SELECTOR FROM DATABASE
// DATABASE IS THE SOURCE OF TRUTH
// =========================================================

async function loadOPDPatientSelector() {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  if (!select) {

    console.warn(
      'OPD patient selector element was not found.'
    );

    return;

  }

  const previousValue =
    String(
      select.value || ''
    );

  /*
   * -------------------------------------------------------
   * SHOW LOADING STATE
   * -------------------------------------------------------
   */

  select.innerHTML = `
    <option value="">
      Loading patients...
    </option>
  `;

  try {

    /*
     * -----------------------------------------------------
     * DATABASE REQUEST
     * -----------------------------------------------------
     *
     * This is the actual endpoint implemented
     * by OPD ROUTE.txt.
     */

    const response =
      await fetch(
        '/api/billing/patients',
        {
          method:
            'GET',

          credentials:
            'same-origin',

          cache:
            'no-store',

          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await response
        .json()
        .catch(
          function () {
            return {};
          }
        );

    /*
     * -----------------------------------------------------
     * VALIDATE RESPONSE
     * -----------------------------------------------------
     */

    if (
      !response.ok ||
      data.success !== true
    ) {

      throw new Error(
        data.message ||
        data.error ||
        `Unable to load patients. HTTP ${response.status}`
      );

    }

    /*
     * -----------------------------------------------------
     * GET PATIENT ARRAY
     * -----------------------------------------------------
     */

    const patients =
      Array.isArray(
        data.patients
      )
        ? data.patients
        : [];

    /*
     * -----------------------------------------------------
     * RESET SELECTOR
     * -----------------------------------------------------
     */

    select.innerHTML = `
      <option value="">
        -- Select OPD Patient --
      </option>
    `;

    /*
     * -----------------------------------------------------
     * CREATE PATIENT OPTIONS
     * -----------------------------------------------------
     */

    patients.forEach(
      function (
        patient
      ) {

        if (
          !patient ||
          !patient.id
        ) {

          return;

        }

        const option =
          document.createElement(
            'option'
          );

        /*
         * IMPORTANT:
         *
         * The value is the PostgreSQL Patient.id.
         *
         * The selected patient is later loaded using:
         *
         * /api/opd/patient/<patient.id>
         */

        option.value =
          String(
            patient.id
          );

        option.textContent =
          `${patient.patient_id || patient.id} — ${
            patient.full_name ||
            patient.name ||
            'Unnamed Patient'
          }`;

        option.dataset.patientId =
          String(
            patient.patient_id || ''
          );

        option.dataset.fullName =
          String(
            patient.full_name ||
            patient.name ||
            ''
          );

        select.appendChild(
          option
        );

      }
    );

    /*
     * -----------------------------------------------------
     * NO PATIENTS
     * -----------------------------------------------------
     */

    if (
      patients.length === 0
    ) {

      select.innerHTML = `
        <option value="">
          No patients currently available in OPD
        </option>
      `;

      clearOPDPatientDetails();

      return;

    }

    /*
     * -----------------------------------------------------
     * RESTORE PREVIOUS SELECTION IF IT STILL EXISTS
     * -----------------------------------------------------
     */

    if (
      previousValue
    ) {

      const stillExists =
        patients.some(
          function (
            patient
          ) {

            return (
              String(
                patient.id
              ) ===
              previousValue
            );

          }
        );

      if (
        stillExists
      ) {

        select.value =
          previousValue;

      }

    }

    /*
     * -----------------------------------------------------
     * LOG DATABASE RESULT
     * -----------------------------------------------------
     */

    console.log(
      'HMS OPD PATIENTS LOADED FROM DATABASE:',
      patients
    );

    console.log(
      'HMS OPD PATIENT COUNT:',
      patients.length
    );

  }

  catch (
    error
  ) {

    console.error(
      'HMS OPD PATIENT SELECTOR LOAD ERROR:',
      error
    );

    select.innerHTML = `
      <option value="">
        Unable to load patients
      </option>
    `;

    clearOPDPatientDetails();

  }

}

// =========================================================
// CLICK CURRENT OPD CARD
// MOVE TO NEXT CARD
// =========================================================

function advanceOPDReportSlide(
  event
) {

  if (
    event &&
    event.target &&
    event.target.closest(
      'button, input, select, textarea, a'
    )
  ) {

    return;

  }

  const slides =
    document.querySelectorAll(
      '.opd-report-slide'
    );

  if (
    !slides.length
  ) {

    return;

  }

  const current =
    Number(
      window.currentOPDReportSlide || 0
    );

  const next =
    (
      current +
      1
    ) %
    slides.length;

  const currentSlide =
    slides[current];

  const nextSlide =
    slides[next];

  if (
    !currentSlide ||
    !nextSlide
  ) {

    return;

  }

  nextSlide.style.display =
    'block';

  nextSlide.style.transform =
    'translateX(100%)';

  nextSlide.style.opacity =
    '0';

  requestAnimationFrame(
    function () {

      currentSlide.style.transform =
        'translateX(-100%)';

      currentSlide.style.opacity =
        '0';

      nextSlide.style.transform =
        'translateX(0)';

      nextSlide.style.opacity =
        '1';

    }
  );

  setTimeout(
    function () {

      currentSlide.style.display =
        'none';

    },
    400
  );

  window.currentOPDReportSlide =
    next;

}

// =========================================================
// COMPLETE OPD PATIENT
// CLOSES PENDING OPD REFERRALS
// REMOVES PATIENT FROM OPD SELECTION
// =========================================================

async function completeOPDPatient(
  button
) {

  const data =
    window.currentOPDPatientData;

  if (
    !data ||
    !data.patient ||
    !data.patient.id
  ) {

    alert(
      'No patient is currently selected.'
    );

    return;

  }

  const patient =
    data.patient;

  const confirmed =
    window.confirm(
      `Complete patient visit for ${patient.full_name || patient.patient_id}?`
    );

  if (
    !confirmed
  ) {

    return;

  }

  if (
    button
  ) {

    button.disabled =
      true;

  }

  try {

    const response =
      await fetch(
        `/api/opd/patient/${patient.id}/complete`,
        {
          method:
            'POST',

          credentials:
            'same-origin',

          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const result =
      await response
        .json()
        .catch(
          function () {
            return {};
          }
        );

    if (
      !response.ok ||
      result.success === false
    ) {

      throw new Error(
        result.message ||
        result.error ||
        'Unable to complete patient visit.'
      );

    }

    window.currentOPDPatientData =
      null;

    window.currentOPDPatientId =
      null;

    window.currentOPDReportSlide =
      0;

    const select =
      document.getElementById(
        'opd-patient-select'
      );

    if (
      select
    ) {

      select.value =
        '';

    }

    const container =
      document.getElementById(
        'medical-reports-list'
      );

    if (
      container
    ) {

      container.innerHTML = `

        <div
          style="
            min-height:520px;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            padding:40px;
            color:#166534;
          "
        >

          <div>

            <h3>
              Patient Visit Completed
            </h3>

            <p>
              ${escapeHTML(
                patient.full_name ||
                patient.patient_id ||
                'Patient'
              )}
              has been removed from the active patient selection.
            </p>

          </div>

        </div>

      `;

    }

    await loadOPDPatientSelector();

    if (
      select
    ) {

      select.value =
        '';

    }

    alert(
      'Patient visit completed successfully.'
    );

  }

  catch (error) {

    console.error(
      'OPD COMPLETION ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to complete patient visit.'
    );

  }

  finally {

    if (
      button
    ) {

      button.disabled =
        false;

    }

  }

}

// =========================================================
// COMPLETE OPD PATIENT
//
// CLOSES THE ENTIRE ACTIVE OPD ENCOUNTER.
//
// DOES NOT REQUIRE A PENDING REFERRAL.
//
// The backend changes:
//
//     current_phase = "OPD Completed"
//
// Any remaining pending OP referral is also completed
// by the backend.
//
// All medical and billing records remain in the database.
// =========================================================

async function completeOPDPatient(
  button
) {

  const data =
    window.currentOPDPatientData;

  if (
    !data ||
    !data.patient ||
    !data.patient.id
  ) {

    alert(
      'No patient is currently selected.'
    );

    return;
  }

  const patient =
    data.patient;

  const patientId =
    Number(
      patient.id
    );

  if (
    !Number.isInteger(
      patientId
    )
  ) {

    alert(
      'Invalid patient.'
    );

    return;
  }

  const confirmed =
    window.confirm(
      `Complete patient visit for ${
        patient.full_name ||
        patient.patient_id ||
        'this patient'
      }?`
    );

  if (
    !confirmed
  ) {

    return;
  }

  if (
    button
  ) {

    button.disabled =
      true;
  }

  try {

    // ===================================================
    // COMPLETE THE OPD ENCOUNTER
    //
    // This endpoint does NOT require a pending referral.
    // ===================================================

    const response =
      await fetch(
        `/api/opd/patient/${encodeURIComponent(
          patientId
        )}/complete`,
        {
          method:
            'POST',

          credentials:
            'same-origin',

          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const result =
      await response
        .json()
        .catch(
          function () {
            return {};
          }
        );

    if (
      !response.ok ||
      result.success === false
    ) {

      throw new Error(
        result.message ||
        result.error ||
        'Unable to complete patient visit.'
      );
    }

    // ===================================================
    // CLEAR CURRENT OPD STATE
    // ===================================================

    window.currentOPDPatientData =
      null;

    window.currentOPDPatientId =
      null;

    window.currentOPDReportSlide =
      0;

    // ===================================================
    // CLEAR PATIENT SELECTOR
    // ===================================================

    const select =
      document.getElementById(
        'opd-patient-select'
      );

    if (
      select
    ) {

      select.value =
        '';
    }

    // ===================================================
    // SHOW COMPLETION MESSAGE
    // ===================================================

    const container =
      document.getElementById(
        'medical-reports-list'
      );

    if (
      container
    ) {

      container.innerHTML = `

        <div
          style="
            min-height:520px;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            padding:40px;
            color:#166534;
          "
        >

          <div>

            <h3>
              Patient Visit Completed
            </h3>

            <p>
              ${escapeHTML(
                patient.full_name ||
                patient.patient_id ||
                'Patient'
              )}
              has been removed from the active patient selection.
            </p>

          </div>

        </div>

      `;
    }

    // ===================================================
    // RELOAD THE SELECTOR FROM DATABASE
    //
    // Because the backend has now changed:
    //
    //     current_phase = "OPD Completed"
    //
    // this patient will no longer appear.
    // ===================================================

    await loadOPDPatientSelector();

    if (
      select
    ) {

      select.value =
        '';
    }

    alert(
      'Patient visit completed successfully.'
    );
  }

  catch (
    error
  ) {

    console.error(
      'OPD COMPLETION ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to complete patient visit.'
    );
  }

  finally {

    if (
      button
    ) {

      button.disabled =
        false;
    }
  }
}


// =========================================================
// UPDATE PATIENT IN DATABASE
// =========================================================

async function adminUpdatePatient(event) {

    event.preventDefault();

    if (
        !adminSelectedPatient ||
        !adminSelectedPatient.id
    ) {

        alert(
            'Please select a patient first.'
        );

        return;
    }

    const nameElement =
        document.getElementById(
            'adm-pt-name'
        );

    const phoneElement =
        document.getElementById(
            'adm-pt-phone'
        );

    if (!nameElement || !phoneElement) {
        return;
    }

    const fullName =
        nameElement.value.trim();

    const phone =
        phoneElement.value.trim();

    if (!fullName) {

        alert(
            'Patient full name is required.'
        );

        nameElement.focus();

        return;
    }

    if (!phone) {

        alert(
            'Patient phone number is required.'
        );

        phoneElement.focus();

        return;
    }

    if (fullName.length > 200) {

        alert(
            'Patient full name is too long.'
        );

        return;
    }

    if (phone.length > 50) {

        alert(
            'Patient phone number is too long.'
        );

        return;
    }

    const button =
        document.getElementById(
            'admin-patient-update-btn'
        );

    const originalText =
        button
            ? button.textContent
            : 'Update Details';

    if (button) {

        button.disabled = true;

        button.textContent =
            'Updating...';

    }

    try {

        const response =
            await fetch(
                `/api/admin/patients/${encodeURIComponent(
                    adminSelectedPatient.id
                )}`,
                {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type':
                            'application/json',
                        'Accept':
                            'application/json'
                    },
                    body: JSON.stringify({
                        full_name: fullName,
                        phone: phone,
                        national_id: document.getElementById('adm-pt-national-id')?.value.trim() || null
                    })
                }
            );

        const data =
            await response.json()
                .catch(() => ({}));

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.error ||
                'Patient update failed.'
            );

        }

        /*
         * Replace the local selected object
         * with the database response.
         */

        adminSelectedPatient =
            data.patient;

        /*
         * Update cached patient object.
         */

        const index =
            adminPatients.findIndex(
                patient =>
                    Number(patient.id) ===
                    Number(
                        adminSelectedPatient.id
                    )
            );

        if (index !== -1) {

            adminPatients[index] =
                adminSelectedPatient;

        }

        /*
         * DO NOT use refreshUI() here.
         *
         * refreshUI() currently rebuilds
         * admin-pt-select from state.patients.
         */

        await loadAdminPatients();

        await loadAdminPtData();

        logAudit(
            `Patient updated by administrator: ${
                adminSelectedPatient.patient_id
            }`
        );

        alert(
            'Patient details updated successfully.'
        );

    } catch (error) {

        console.error(
            'ADMIN PATIENT UPDATE ERROR:',
            error
        );

        alert(
            error.message ||
            'Unable to update patient.'
        );

    } finally {

        if (button) {

            button.disabled = false;

            button.textContent =
                originalText;

        }

    }

}

// =========================================================
// MERGE DUPLICATE PATIENT
// DATABASE-BACKED
// =========================================================

async function mergePatientRecord() {

    if (
        !adminSelectedPatient ||
        !adminSelectedPatient.id
    ) {

        alert(
            'Select the primary patient first.'
        );

        return;
    }

    const targetElement =
        document.getElementById(
            'adm-merge-target'
        );

    if (!targetElement) {
        return;
    }

    const duplicatePatientId =
        targetElement.value.trim();

    if (!duplicatePatientId) {

        alert(
            'Enter the Patient ID of the duplicate record.'
        );

        targetElement.focus();

        return;
    }

    const primaryPatientId =
        String(
            adminSelectedPatient.patient_id || ''
        )
        .trim()
        .toLowerCase();

    if (
        duplicatePatientId.toLowerCase() ===
        primaryPatientId
    ) {

        alert(
            'A patient cannot be merged into itself.'
        );

        return;
    }

    try {

        // -------------------------------------------------
        // IMPORTANT:
        // Reload patients directly from the database
        // before searching for the duplicate.
        // -------------------------------------------------

        const response =
            await fetch(
                '/api/admin/patients',
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        'Accept':
                            'application/json'
                    }
                }
            );

        const data =
            await response.json()
                .catch(() => ({}));

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.error ||
                'Unable to load current patient records.'
            );

        }

        // -------------------------------------------------
        // Replace the old cached patient list
        // with the current database result.
        // -------------------------------------------------

        adminPatients =
            Array.isArray(data.patients)
                ? data.patients
                : [];

        // -------------------------------------------------
        // FIND DUPLICATE FROM FRESH DATABASE DATA
        // -------------------------------------------------

        const duplicate =
            adminPatients.find(
                patient =>
                    String(
                        patient.patient_id || ''
                    )
                    .trim()
                    .toLowerCase() ===
                    duplicatePatientId
                        .trim()
                        .toLowerCase()
            );

        if (!duplicate) {

            alert(
                `The duplicate Patient ID "${duplicatePatientId}" was not found in the database.`
            );

            return;
        }

        // -------------------------------------------------
        // DO NOT MERGE AN ALREADY MERGED RECORD
        // -------------------------------------------------

        if (
            String(
                duplicate.status || ''
            )
            .trim()
            .toUpperCase() === 'MERGED'
        ) {

            alert(
                'This patient record has already been merged.'
            );

            return;
        }

        // -------------------------------------------------
        // CONFIRM MERGE
        // -------------------------------------------------

        const confirmed =
            confirm(
                `Merge patient ${duplicate.patient_id} into ${adminSelectedPatient.patient_id}?\n\n` +
                `The selected patient will remain the primary record.\n` +
                `The duplicate record will NOT be physically deleted.`
            );

        if (!confirmed) {
            return;
        }

        // -------------------------------------------------
        // SEND MERGE TO DATABASE
        // -------------------------------------------------

        const mergeResponse =
            await fetch(
                `/api/admin/patients/${encodeURIComponent(
                    adminSelectedPatient.id
                )}/merge`,
                {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type':
                            'application/json',
                        'Accept':
                            'application/json'
                    },
                    body: JSON.stringify({
                        duplicate_patient_id:
                            duplicate.patient_id
                    })
                }
            );

        const mergeData =
            await mergeResponse.json()
                .catch(() => ({}));

        if (
            !mergeResponse.ok ||
            !mergeData.success
        ) {

            throw new Error(
                mergeData.error ||
                'Patient merge failed.'
            );

        }

        // -------------------------------------------------
        // AUDIT
        // -------------------------------------------------

        if (
            typeof logAudit ===
            'function'
        ) {

            logAudit(
                `Patient ${duplicate.patient_id} merged into ${adminSelectedPatient.patient_id}`
            );

        }

        // -------------------------------------------------
        // CLEAR DUPLICATE FIELD
        // -------------------------------------------------

        targetElement.value = '';

        // -------------------------------------------------
        // RELOAD PATIENTS FROM DATABASE
        // -------------------------------------------------

        await loadAdminPatients();

        // -------------------------------------------------
        // RESELECT PRIMARY PATIENT
        // -------------------------------------------------

        const select =
            document.getElementById(
                'admin-pt-select'
            );

        if (select) {

            select.value =
                String(
                    adminSelectedPatient.id
                );

        }

        await loadAdminPtData();

        // -------------------------------------------------
        // SUCCESS
        // -------------------------------------------------

        alert(
            'Patient records merged successfully.'
        );

    } catch (error) {

        console.error(
            'ADMIN PATIENT MERGE ERROR:',
            error
        );

        alert(
            error.message ||
            'Unable to merge patient records.'
        );

    }

}

// =========================================================
// CLEAR PATIENT FORM
// =========================================================

function clearAdminPatientForm() {

    adminSelectedPatient = null;

    const fields = [
        'adm-pt-id',
        'adm-pt-name',
        'adm-pt-dob',
        'adm-pt-gender',
        'adm-pt-phone',
        'adm-pt-status',
        'adm-merge-primary'
    ];

    fields.forEach(
        id => {

            const element =
                document.getElementById(id);

            if (element) {

                element.value = '';

            }

        }
    );

}

// =========================================================
// USERS
// =========================================================

async function addUser(event) {

    event.preventDefault();

    const username =
        document.getElementById('u-name')?.value.trim();

    const password =
        document.getElementById('u-password')?.value || '';

    const role =
        document.getElementById('u-role')?.value || '';

    if (!username || !password || !role) {

        alert(
            'Username, password and role are required.'
        );

        return;
    }

    try {

        const response = await fetch(
            '/api/users',
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                credentials: 'same-origin',

                body: JSON.stringify({
                    username: username,
                    password: password,
                    role: role
                })
            }
        );

        const data =
            await response.json();

        if (!response.ok || !data.success) {

            alert(
                data.error ||
                data.message ||
                'Failed to create user account.'
            );

            return;
        }

        alert(
            'User Account Created Successfully.'
        );

        event.target.reset();

        await loadSystemUsers();

    } catch (error) {

        console.error(
            'User creation error:',
            error
        );

        alert(
            'Unable to connect to the HMS server.'
        );
    }
}

// =========================================================
// LOAD USERS FROM DATABASE
// =========================================================

async function loadSystemUsers() {

    const table = document.getElementById('admin-users-table');

    if (!table) {
        console.error('admin-users-table was not found');
        return;
    }

    try {

        const response = await fetch('/api/users', {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        });

        const data = await response.json();

        console.log('DATABASE USERS:', data);

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || 'Failed to load users'
            );
        }

        const users = data.users || [];

        if (users.length === 0) {

            table.innerHTML = `
                <tr>
                    <td colspan="4">
                        No system users found.
                    </td>
                </tr>
            `;

            return;
        }

        const roleLabels = {
            admin: 'System Admin',
            system_admin: 'System Admin',
            hospital_manager: 'Hospital Manager',
            doctor: 'Doctor',
            nurse: 'Nurse',
            labtech: 'Lab Tech',
            pharmacist: 'Pharmacist',
            radiologist: 'Radiologist',
            surgeon: 'Surgeon',
            opd: 'OPD',
            receptionist: 'Receptionist',
            accountant: 'Finance Officer'
        };

        table.innerHTML = users.map(user => {

            const role =
                roleLabels[user.role] ||
                user.role ||
                'Unknown';

            const status =
                user.is_active === true
                    ? 'Active'
                    : 'Inactive';

            return `
                <tr>
                    <td>${user.username}</td>
                    <td>${role}</td>
                    <td>${status}</td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-warning btn-sm"
                        onclick="toggleSystemUserStatus(${user.id})"
                      >
                        ${user.is_active ? 'Disable' : 'Enable'}
                      </button>

                      <button
                        type="button"
                        class="btn btn-danger btn-sm"
                        onclick="deleteSystemUser(${user.id})"
                      >
                        Delete
                      </button>

                    </td>
                </tr>
            `;

        }).join('');

    } catch (error) {

        console.error(
            'LOAD SYSTEM USERS ERROR:',
            error
        );

        table.innerHTML = `
            <tr>
                <td colspan="4">
                    Unable to load system users.
                </td>
            </tr>
        `;
    }
}

// =========================================================
// ENABLE / DISABLE SYSTEM USER
// =========================================================

async function toggleSystemUserStatus(userId) {

    try {

        const response = await fetch(
            `/api/users/${userId}/toggle-status`,
            {
                method: 'PATCH',
                credentials: 'same-origin'
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            alert(
                data.error ||
                'Unable to change user status.'
            );

            return;
        }

        await loadSystemUsers();

    } catch (error) {

        console.error(
            'Toggle user status error:',
            error
        );

        alert(
            'Unable to connect to the HMS server.'
        );
    }
}

// =========================================================
// DELETE SYSTEM USER
// =========================================================

async function deleteSystemUser(userId) {

    const confirmed =
        confirm(
            'Are you sure you want to permanently delete this user account?'
        );

    if (!confirmed) {
        return;
    }

    try {

        const response = await fetch(
            `/api/users/${userId}`,
            {
                method: 'DELETE',
                credentials: 'same-origin'
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            alert(
                data.error ||
                'Unable to delete user account.'
            );

            return;
        }

        await loadSystemUsers();

    } catch (error) {

        console.error(
            'Delete user error:',
            error
        );

        alert(
            'Unable to connect to the HMS server.'
        );
    }
}

// =========================================================
// DELETE STAFF
// =========================================================

async function deleteStaff(id) {

    if (
        !confirm(
            'Are you sure you want to delete this staff member?'
        )
    ) {
        return;
    }

    try {

        const response =
            await fetch(
                `/api/staff/${id}`,
                {
                    method: 'DELETE'
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to delete staff member.'
            );

        }

        await loadStaffFromDatabase();

    } catch (error) {

        console.error(
            'Staff deletion error:',
            error
        );

        alert(
            error.message ||
            'Unable to delete staff member.'
        );

    }

}

// =========================================================
// EDIT STAFF
// =========================================================

async function editStaff(id) {

    try {

        const response =
            await fetch(
                `/api/staff/${id}`
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                data.error ||
                'Unable to load staff member.'
            );

        }

        const staff =
            data.staff;

        const name =
            prompt(
                'Full Name:',
                staff.full_name ||
                staff.name ||
                ''
            );

        if (name === null) {
            return;
        }

        const role =
            prompt(
                'Role:',
                staff.role ||
                ''
            );

        if (role === null) {
            return;
        }

        /*
         * PHONE
         */

        const phone =
            prompt(
                'Phone Number:',
                staff.phone ||
                ''
            );

        if (phone === null) {
            return;
        }

        /*
         * EMAIL
         */

        const email =
            prompt(
                'Email:',
                staff.email ||
                ''
            );

        if (email === null) {
            return;
        }

        /*
         * UPDATE DATABASE
         */

        const updateResponse =
            await fetch(
                `/api/staff/${id}`,
                {

                    method: 'PUT',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify({

                        name:
                            name.trim(),

                        role:
                            role.trim().toLowerCase(),

                        phone:
                            phone.trim(),

                        email:
                            email.trim()

                    })

                }
            );

        const updateData =
            await updateResponse.json();

        if (
            !updateResponse.ok ||
            !updateData.success
        ) {

            throw new Error(
                updateData.message ||
                updateData.error ||
                'Unable to update staff member.'
            );

        }

        await loadStaffFromDatabase();

        alert(
            'Staff member updated successfully.'
        );

    } catch (error) {

        console.error(
            'Staff edit error:',
            error
        );

        alert(
            error.message ||
            'Unable to edit staff member.'
        );

    }

}

// =========================================================
// USER STATUS
// =========================================================

function toggleUserStatus(name) {

  const user =
    state.users.find(
      item =>
        item.name === name
    );

  if (!user) return;

  user.status =
    user.status === 'Active'
      ? 'Disabled'
      : 'Active';

  logAudit(
    `User status changed: ${
      user.name
    } -> ${
      user.status
    }`
  );

  refreshUI();

}

// =========================================================
// SIMPLE SELECT
// =========================================================

function preserveValue(id) {

  const element =
    document.getElementById(id);

  return element
    ? element.value
    : '';

}

function populateSimpleSelect(
  elementId,
  values,
  placeholder,
  selectedValue = ''
) {

  const select =
    document.getElementById(
      elementId
    );

  if (!select) return;

  if (!values.length) {

    select.innerHTML = `

      <option value="">
        ${escapeHTML(
          placeholder
        )} - None configured
      </option>

    `;

    return;

  }

  select.innerHTML = `

    <option value="">
      ${escapeHTML(placeholder)}
    </option>

  ` +

  values
    .map(
      value => `

        <option
          value="${escapeHTML(value)}"
          ${
            value === selectedValue
              ? 'selected'
              : ''
          }
        >
          ${escapeHTML(value)}
        </option>

      `
    )
    .join('');

}

// =========================================================
// PATIENT SELECT
// =========================================================

function populateSelect(
  elementId,
  filterFunction,
  selectedValue = ''
) {

  const select =
    document.getElementById(
      elementId
    );

  if (!select) {
    return;
  }

  const patients =
    state.patients.filter(
      filterFunction
    );

  if (!patients.length) {

    select.innerHTML = `
      <option value="">
        No patients available in queue
      </option>
    `;

    return;
  }

  // ---------------------------------------------------------
  // TRIAGE USES THE DATABASE PATIENT ID
  //
  // patient.id         = P-5820
  // patient.patient_id = P-5820
  // patient.databaseId = PostgreSQL patients.id
  //
  // The backend /api/triage/ expects patients.id.
  // ---------------------------------------------------------

  const isTriageSelect =
    elementId ===
    'triage-patient-select';

  select.innerHTML = `
    <option value="">
      Select Patient
    </option>
  `;

  patients.forEach(
    patient => {

      let optionValue;

      if (isTriageSelect) {

        optionValue =
          patient.databaseId;

      } else {

        optionValue =
          patient.id;

      }

      // -------------------------------------------------------
      // Do not create an invalid Triage option
      // -------------------------------------------------------

      if (
        isTriageSelect &&
        (
          optionValue === undefined ||
          optionValue === null ||
          optionValue === ''
        )
      ) {

        return;

      }

      const option =
        document.createElement(
          'option'
        );

      option.value =
        String(
          optionValue
        );

      if (Number.isInteger(Number(optionValue))) {
        option.dataset.databasePatientId = String(optionValue);
      }

      option.textContent =
        `${patient.patient_id || patient.id} - ${
          patient.full_name ||
          patient.name ||
          ''
        }${
          patient.phase
            ? ` (${patient.phase})`
            : ''
        }`;

      if (
        selectedValue !== undefined &&
        selectedValue !== null &&
        String(optionValue) ===
          String(selectedValue)
      ) {

        option.selected =
          true;

      }

      select.appendChild(
        option
      );

    }
  );

}

// =========================================================
// LIVE DAILY DASHBOARD METRICS
// =========================================================

function getTodayStart() {
  const now = new Date();

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  );
}

function updatePharmacyDispenseCostPreview() {
  const preview = document.getElementById('pharm-dispense-cost-preview');
  if (!preview) return;
  const itemId = document.getElementById('p-item-select')?.value;
  const item = pharmacyInventory.find(row => String(row.id) === String(itemId));
  const quantity = Number(document.getElementById('p-qty')?.value || 0);
  const unit = String(document.getElementById('p-unit-select')?.value || '').toLowerCase();
  if (!item || !quantity || !unit) {
    preview.textContent = 'Select a medicine, unit and quantity to preview the patient charge.';
    return;
  }
  let unitCost = Number(item.price_per_unit || 0);
  const tabletStock = String(item.valuation_method || '').toLowerCase() === 'strips / boxes';
  if (tabletStock && unit === 'box') {
    unitCost = item.price_per_box == null
      ? unitCost * Number(item.strips_per_box || 0)
      : Number(item.price_per_box);
  }
  const total = quantity * unitCost;
  preview.textContent = `Estimated pharmacy charge: ${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${quantity} ${unit}${quantity === 1 ? '' : 's'} at ${unitCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} per ${unit})`;
}

function isToday(dateValue) {
  if (!dateValue) return false;

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();

  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  );

  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 0, 0, 0
  );

  return date >= start && date < end;
}


// ---------------------------------------------------------
// PATIENTS REGISTERED TODAY
// ---------------------------------------------------------

function getPatientsToday() {

  return state.patients.filter(patient =>
    isToday(patient.createdAt)
  ).length;

}

// ---------------------------------------------------------
// ADMISSIONS TODAY
// ---------------------------------------------------------

function getAdmissionsToday() {

  return state.patients.reduce(
    (count, patient) => {

      const history =
        Array.isArray(patient.nursingHistory)
          ? patient.nursingHistory
          : [];

      return count +
        history.filter(entry =>
          String(entry.action || '')
            .toLowerCase()
            .startsWith('admitted to') &&
          isToday(entry.date)
        ).length;

    },
    0
  );

}

// ---------------------------------------------------------
// DISCHARGES TODAY
// ---------------------------------------------------------

function getDischargesToday() {

  return state.patients.reduce(
    (count, patient) => {

      const history =
        Array.isArray(patient.nursingHistory)
          ? patient.nursingHistory
          : [];

      return count +
        history.filter(entry =>
          String(entry.action || '')
            .toLowerCase()
            .startsWith('discharged from') &&
          isToday(entry.date)
        ).length;

    },
    0
  );

}

// ---------------------------------------------------------
// REVENUE TODAY
// ---------------------------------------------------------

function getRevenueToday() {

  return state.patients.reduce(
    (total, patient) => {

      const payments =
        Array.isArray(patient.paymentHistory)
          ? patient.paymentHistory
          : [];

      const todayPayments =
        payments
          .filter(payment =>
            isToday(payment.date)
          )
          .reduce(
            (sum, payment) =>
              sum + Number(payment.amount || 0),
            0
          );

      return total + todayPayments;

    },
    0
  );

}
// =========================================================
// SAVE TRIAGE
// =========================================================

async function saveTriage(event) {

  event.preventDefault();

  try {

    // -------------------------------------------------------
    // PATIENT
    // -------------------------------------------------------

    const patientSelect =
      document.getElementById(
        'triage-patient-select'
      );

    const patientId =
      patientSelect?.value?.trim();

    if (!patientId) {

      alert(
        'Select a patient from the Triage Queue.'
      );

      return;

    }

    // -------------------------------------------------------
    // DEPARTMENT / CLINIC
    // -------------------------------------------------------

    const departmentSelect =
      document.getElementById(
        'v-assigned-clinic'
      );

    const departmentId =
      departmentSelect?.value?.trim();

    if (!departmentId) {

      alert(
        'Select the department / clinic.'
      );

      return;

    }

    
    // -------------------------------------------------------
// TRIAGE DATA
// -------------------------------------------------------

const weight =
  document.getElementById(
    'v-weight'
  )?.value || null;

const height =
  document.getElementById(
    'v-height'
  )?.value || null;

const bmi =
  document.getElementById(
    'v-bmi'
  )?.value || null;

const bloodPressure =
  document.getElementById(
    'v-bp'
  )?.value?.trim() || '';

const temperature =
  document.getElementById(
    'v-temp'
  )?.value || null;

const pulse =
  document.getElementById(
    'v-pulse'
  )?.value || null;

const respiratoryRate =
  document.getElementById(
    'v-rr'
  )?.value || null;

const spo2 =
  document.getElementById(
    'v-spo2'
  )?.value || null;

const bloodSugar =
  document.getElementById(
    'v-bs'
  )?.value || null;

const painScore =
  document.getElementById(
    'v-pain'
  )?.value || null;

const complaint =
  document.getElementById(
    'v-complaint'
  )?.value?.trim() || '';

const allergies =
  document.getElementById(
    'v-allergies'
  )?.value?.trim() || '';

const pregnancy =
  document.getElementById(
    'v-preg'
  )?.value || '';

const gcs =
  document.getElementById(
    'v-gcs'
  )?.value?.trim() || '';

const fallRisk =
  document.getElementById(
    'v-fall'
  )?.value || '';

const priority =
  document.getElementById(
    'v-priority'
  )?.value || 'Routine';
    // -------------------------------------------------------
    // PAYLOAD
    // -------------------------------------------------------
    const payload = {

  patient_id:
    patientId,

  department_id:
    Number(departmentId),

  weight:
    weight,

  height:
    height,

  bmi:
    bmi,

  blood_pressure:
    bloodPressure,

  temperature:
    temperature,

  pulse:
    pulse,

  respiratory_rate:
    respiratoryRate,

  spo2:
    spo2,

  blood_sugar:
    bloodSugar,

  pain_score:
    painScore,

  chief_complaint:
    complaint,

  allergies:
    allergies,

  pregnancy:
    pregnancy,

  gcs:
    gcs,

  fall_risk:
    fallRisk,

  priority:
    priority

};
    
    

    console.log(
      'TRIAGE SAVE PAYLOAD:',
      payload
    );

    // -------------------------------------------------------
    // SAVE TO DATABASE
    // -------------------------------------------------------

    const response =
      await fetch(
        '/api/triage/',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          credentials:
            'same-origin',

          cache:
            'no-store',

          body:
            JSON.stringify(payload)
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    console.log(
      'TRIAGE SAVE RESPONSE:',
      response.status,
      data
    );

    // -------------------------------------------------------
    // ERROR
    // -------------------------------------------------------

    if (!response.ok) {

      console.error(
        'TRIAGE SAVE FAILED:',
        data
      );

      alert(
        data.message ||
        data.error ||
        'Failed to save triage data.'
      );

      return;

    }

    console.log(
  'TRIAGE SAVE SUCCESS:',
  data
);

// -------------------------------------------------------
// UPDATE FRONTEND PATIENT AFTER SUCCESSFUL DATABASE SAVE
// -------------------------------------------------------

const savedPatient =
  state.patients.find(
    patient =>
      String(
        patient.patient_id ||
        patient.id ||
        ''
      ) ===
      String(
        patientId
      )
  );

if (savedPatient) {

  savedPatient.phase =
    'Doctor Queue';

  savedPatient.current_phase =
    'Doctor Queue';

  savedPatient.department_id =
    Number(departmentId);

  savedPatient.clinic =
    departmentSelect
      ?.selectedOptions?.[0]
      ?.textContent
      ?.trim() || '';

  savedPatient.current_priority = priority;
  loadTriagePatientQueue();

}

// -------------------------------------------------------
// REFRESH TRIAGE QUEUE
// -------------------------------------------------------

loadTriagePatientQueue();

alert(
  'Triage data saved successfully.'
);
    


    // -------------------------------------------------------
    // CLEAR TRIAGE FORM
    // -------------------------------------------------------

    const form =
      event.target;

    if (
      form &&
      typeof form.reset ===
      'function'
    ) {

      form.reset();

    }

  } catch (error) {

    console.error(
      'TRIAGE SAVE ERROR:',
      error
    );


    console.log(
  'TRIAGE SAVE SUCCESS:',
  data
);

// -------------------------------------------------------
// UPDATE THE EXISTING FRONTEND PATIENT
// -------------------------------------------------------

const savedPatient =
  state.patients.find(
    patient =>
      String(
        patient.patient_id ||
        patient.id ||
        ''
      ) ===
      String(
        patientId
      )
  );

if (savedPatient) {

  savedPatient.phase =
    'Doctor Queue';

  savedPatient.current_phase =
    'Doctor Queue';

  savedPatient.department_id =
    Number(departmentId);

  savedPatient.clinic =
    departmentSelect
      ?.selectedOptions?.[0]
      ?.textContent
      ?.trim() || '';

  savedPatient.current_priority =
    priority;

}

// -------------------------------------------------------
// REFRESH TRIAGE QUEUE
// -------------------------------------------------------

if (
  typeof loadTriagePatientQueue ===
  'function'
) {

  loadTriagePatientQueue();

}
    alert(
      'An error occurred while saving triage data.'
    );

  }

}


// ---------------------------------------------------------
// TRIAGE WORKLOAD
// ---------------------------------------------------------

function getTriageWorkload() {

  return state.patients.filter(
    patient =>
      patient.phase === 'Triage Queue'
  ).length;

}

// ---------------------------------------------------------
// DOCTOR WORKLOAD
// ---------------------------------------------------------

function getDoctorWorkload() {

  return state.patients.filter(
    patient =>
      patient.phase === 'Doctor Queue' ||
      patient.phase === 'Doctor Review'
  ).length;

}

// ---------------------------------------------------------
// LABORATORY WORKLOAD
// ---------------------------------------------------------

function getLaboratoryWorkload() {

  return state.patients.filter(
    patient =>
      Array.isArray(patient.labOrders) &&
      patient.labOrders.some(
        order =>
          String(order.status || '')
            .toLowerCase() === 'pending'
      )
  ).length;

}

// ---------------------------------------------------------
// RADIOLOGY WORKLOAD
// ---------------------------------------------------------

function getRadiologyWorkload() {

  return state.patients.filter(
    patient =>
      Array.isArray(patient.radiologyOrders) &&
      patient.radiologyOrders.some(
        order =>
          String(order.status || '')
            .toLowerCase() === 'pending'
      )
  ).length;

}

// ---------------------------------------------------------
// PHARMACY WORKLOAD
// ---------------------------------------------------------

function getPharmacyWorkload() {

  return state.patients.filter(
    patient =>
      patient.phase === 'Pharmacy Queue'
  ).length;

}

// ---------------------------------------------------------
// THEATRE WORKLOAD & NURSING WORKLOAD
// ---------------------------------------------------------

var theatreReferralWorkload = 0;
var nursingReferralWorkload = 0;

async function refreshReferralWorkloads() {

  try {

    const [
      nursingResponse,
      theatreResponse
    ] = await Promise.all([
      fetch('/api/nursing/referrals'),
      fetch('/api/surgery/referrals')
    ]);

    if (
      !nursingResponse.ok ||
      !theatreResponse.ok
    ) {
      throw new Error(
        'Failed to load referral workloads'
      );
    }

    const [
      nursingReferrals,
      theatreReferrals
    ] = await Promise.all([
      nursingResponse.json(),
      theatreResponse.json()
    ]);

    nursingReferralWorkload =
      Array.isArray(nursingReferrals)
        ? nursingReferrals.length
        : 0;

    theatreReferralWorkload =
      Array.isArray(theatreReferrals)
        ? theatreReferrals.length
        : 0;

  } catch (error) {

    console.error(
      'Failed to load referral workloads:',
      error
    );

    nursingReferralWorkload = 0;
    theatreReferralWorkload = 0;
  }
}

function getTheatreWorkload() {
  return theatreReferralWorkload;
}

function getNursingWorkload() {
  return nursingReferralWorkload;
}

// ---------------------------------------------------------
// WAITING QUEUE
// ---------------------------------------------------------

function getWaitingQueue() {

  const waitingPhases = [
    'Triage Queue',
    'Doctor Queue',
    'Doctor Review',
    'Awaiting Lab Results',
    'Awaiting Radiology',
    'Pharmacy Queue',
    'Nurse Referral Queue',
    'Theatre Referral Queue',
    'Billing Queue'
  ];

  return state.patients.filter(
    patient =>
      waitingPhases.includes(
        patient.phase
      )
  ).length;

}

// =========================================================
// FULL REFRESH ENGINE
// =========================================================

function refreshUI() {

  // =======================================================
  // DASHBOARD WORKFLOW
  // =======================================================

  const dashTbody =
    document.getElementById(
      'dash-workflow-table'
    );

  if (
    dashTbody &&
    !document
      .getElementById('mod-dash')
      ?.classList.contains('active')
  ) {

    if (!state.patients.length) {

      dashTbody.innerHTML = `

        <tr>

          <td
            colspan="8"
            style="text-align:center;color:#6c757d;"
          >
            No active patient encounters in system.
          </td>

        </tr>

      `;

    }

    else {

      dashTbody.innerHTML =
  state.patients
    .filter(
      patient => {
        return !(
          typeof window.isPatientHiddenFromLiveTracker === 'function' &&
          window.isPatientHiddenFromLiveTracker(patient)
        );
      }
    )
    .map(
      patient => {
              const priority =
                patient.vitals?.priority ||
                'Unassigned';

              const priorityClass =
                priority.includes('P1')
                  ? 'badge-p1'
                  : priority.includes('P2')
                    ? 'badge-p2'
                    : 'badge-p3';

              const bill =
                Number(
                  patient.bill || 0
                );

              const paid =
                Number(
                  patient.amountPaid || 0
                );

              const balance =
                Math.max(
                  0,
                  bill - paid
                );

              const followUpFlag =
                patient.followUp?.active &&
                !patient.followUp?.doctorNotified
                  ? '🚩'
                  : '';

              return `

                <tr>

                  <td>

                    <strong>
                      ${escapeHTML(
                        patient.id
                      )}
                    </strong>

                  </td>

                  <td>

                    ${escapeHTML(
                      patient.name
                    )}

                    ${
                      patient.followUp?.active
                        ? `
                          <span
                            title="Follow-up activated"
                            style="color:red;"
                          >
                            🚩
                          </span>
                        `
                        : ''
                    }

                  </td>

                  <td>

                    <span class="badge badge-p2">
                      ${escapeHTML(
                        patient.phase
                      )}
                    </span>

                  </td>

                  <td>

                    <span
                      class="badge ${priorityClass}"
                    >
                      ${escapeHTML(priority)}
                    </span>

                  </td>

                  <td class="hms-vitals-cell">
                    <span><strong>BP:</strong> ${escapeHTML(patient.vitals?.bp || patient.vitals?.blood_pressure || 'Not recorded')}</span>
                    <span><strong>SpO₂:</strong> ${escapeHTML(patient.vitals?.spo2 ?? patient.vitals?.oxygen_saturation ?? 'Not recorded')}${(patient.vitals?.spo2 ?? patient.vitals?.oxygen_saturation) !== undefined && (patient.vitals?.spo2 ?? patient.vitals?.oxygen_saturation) !== null && String(patient.vitals?.spo2 ?? patient.vitals?.oxygen_saturation).trim() !== '' ? '%' : ''}</span>
                  </td>

                  <td>

                    ${escapeHTML(
                      patient.diagnosis
                    )}

                  </td>

                  <td>

                    <strong>
                      ${money(bill)}
                    </strong>

                    <br>

                    <small>
                      Paid:
                      ${money(paid)}
                      <br>
                      Balance:
                      ${money(balance)}
                      <br>
                      ${escapeHTML(
                        patient.billingStatus ||
                        'Pending'
                      )}
                    </small>

                  </td>

                  <td>

                    <button
                      type="button"
                      class="btn btn-danger btn-sm"
                    onclick="window.removePatientFromLiveTracker(
                    '${escapeHTML(patient.id)}')"
                    >
                      Delete
                    </button>

                  </td>

                </tr>

              `;

            }
          )
          .join('');

    }

  }

// =========================================================
// DASHBOARD — DATABASE-BACKED LOADER
// =========================================================
let hmsDashboardRefreshTimer = null;

let hmsDashboardRequestVersion = 0;

async function loadDashboardFromDatabase() {

    const requestVersion = ++hmsDashboardRequestVersion;

    const workflowTable = document.getElementById(
        'dash-workflow-table'
    );

    if (!workflowTable) {
        return;
    }

    workflowTable.innerHTML = `
        <tr>
            <td colspan="8" style="text-align:center;">
                Loading dashboard data from database...
            </td>
        </tr>
    `;

    try {

        const response = await fetch(
            '/dashboard/api',
            {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        const data = await response.json();

        // Ignore responses from older dashboard requests.
        if (requestVersion !== hmsDashboardRequestVersion) {
          return;
        }

        if (!response.ok || !data.success) {
            throw new Error(
                data.error ||
                data.message ||
                'Unable to load dashboard data.'
            );
        }

        const stats = data.statistics || {};

        // =================================================
        // MAIN STATISTICS
        // =================================================

        setText(
            'stat-patients',
            stats.patients_today ?? 0
        );

        setText(
            'stat-waiting',
            stats.waiting ?? 0
        );

        setText(
            'stat-admit',
            `${stats.admissions ?? 0} / ${stats.discharges ?? 0}`
        );

        setText(
            'stat-admissions',
            stats.admissions ?? 0
        );

        setText(
            'stat-discharges',
            stats.discharges ?? 0
        );

        setText(
            'stat-revenue',
            money(stats.revenue_today ?? 0)
        );

        // =================================================
        // BEDS
        // =================================================

        const beds = stats.beds || {};

        setText(
            'stat-beds',
            `${beds.available ?? 0} / ${beds.total ?? 0}`
        );

        // =================================================
        // STAFF AND EMERGENCIES
        // =================================================

        // =================================================
        // STAFF ON DUTY / TOTAL STAFF
        // =================================================
        setText(
          'stat-staff-count',
          `${stats.staff_on_duty ?? 0} / ${stats.total_staff ?? 0}`
        );
        // =================================================
        // ALL WORKLOAD CARDS
        // DATABASE API IS THE SOURCE OF TRUTH
        // =================================================

        setText(
            'stat-triage-workload',
            `${stats.triage_workload ?? 0} Pending`
        );

        setText(
            'stat-doctor-workload',
            `${stats.doctor_workload ?? 0} Pending`
        );

        setText(
            'stat-lab-workload',
            `${stats.lab_workload ?? 0} Pending`
        );

        setText(
            'stat-rad-workload',
            `${stats.radiology_workload ?? 0} Pending`
        );

        setText(
            'stat-pharm-workload',
            `${stats.pharmacy_workload ?? 0} Pending`
        );

        setText(
            'stat-theatre-workload',
            `${stats.theatre_workload ?? 0} Pending`
        );

        setText(
            'stat-nurse-workload',
            `${stats.nursing_workload ?? 0} Under Care`
        );

        // =================================================
        // LIVE PATIENT WORKFLOW TRACKER
        // =================================================

        const patients = Array.isArray(data.workflow)
            ? data.workflow
            : [];

        // Preserve the existing feature that hides selected
        // patients from this visible tracker only.
        const hiddenIds = (() => {

            try {

                const saved = JSON.parse(
                    localStorage.getItem(
                        'hms_live_tracker_hidden_patients'
                    ) || '[]'
                );

                return Array.isArray(saved)
                    ? saved.map(String)
                    : [];

            } catch (error) {

                console.warn(
                    'Unable to read hidden dashboard patients:',
                    error
                );

                return [];
            }

        })();

        const visiblePatients = patients.filter(
            patient => {

                const id = String(
                    patient.patient_id ??
                    patient.patient_number ??
                    patient.id ??
                    ''
                );

                return !hiddenIds.includes(id);
            }
        );

        // =================================================
        // EMPTY WORKFLOW TABLE
        // =================================================

        if (visiblePatients.length === 0) {

            workflowTable.innerHTML = `
                <tr>
                    <td
                        colspan="8"
                        style="text-align:center;color:#6c757d;"
                    >
                        No patient workflow records found in the database.
                    </td>
                </tr>
            `;

        } else {

            // =============================================
            // RENDER WORKFLOW ROWS
            // =============================================

            workflowTable.innerHTML = visiblePatients.map(
                patient => {

                    const priority =
                        patient.priority || 'Unassigned';

                    const priorityText =
                        String(priority);

                    const priorityClass =
                        /P1|CRITICAL|RED/i.test(priorityText)
                            ? 'badge-p1'
                            : /P2|HIGH|ORANGE/i.test(priorityText)
                                ? 'badge-p2'
                                : 'badge-p3';

                    const patientId =
                        patient.patient_number ||
                        patient.patient_id ||
                        patient.id ||
                        '-';

                    const name =
                        patient.name || 'Unknown Patient';

                    const stage =
                        patient.stage || 'Unknown';

                    const vitals =
                        patient.vitals || '-';

                    const diagnosis =
                        patient.diagnosis || '-';

                    const billing =
                        patient.billing || 'No Bill';

                    const amount =
                        Number(patient.billing_amount || 0);

                    const balance =
                        Number(patient.balance || 0);

                    // The backend sends the internal database
                    // patient ID in patient_id.
                    const internalId =
                        patient.patient_id ??
                        patient.id ??
                        '';

                    return `
                        <tr>

                            <td>
                                <strong>
                                    ${escapeHTML(patientId)}
                                </strong>
                            </td>

                            <td>
                                ${escapeHTML(name)}
                            </td>

                            <td>
                                <span class="badge badge-p2">
                                    ${escapeHTML(stage)}
                                </span>
                            </td>

                            <td>
                                <span class="badge ${priorityClass}">
                                    ${escapeHTML(priorityText)}
                                </span>
                            </td>

                            <td class="hms-vitals-cell">
                                <span><strong>BP:</strong> ${escapeHTML(patient.blood_pressure || 'Not recorded')}</span>
                                <span><strong>SpO₂:</strong> ${patient.spo2 !== null && patient.spo2 !== undefined && String(patient.spo2).trim() !== '' ? escapeHTML(patient.spo2)+'%' : 'Not recorded'}</span>
                            </td>

                            <td>
                                ${escapeHTML(diagnosis)}
                            </td>

                            <td>
                                <strong>
                                    ${money(amount)}
                                </strong>

                                <br>

                                <small>
                                    Balance: ${money(balance)}
                                    <br>
                                    ${escapeHTML(billing)}
                                </small>
                            </td>

                            <td>
                                <button
                                    type="button"
                                    class="btn btn-danger btn-sm hms-tracker-remove"
                                    data-dashboard-patient-id="${escapeHTML(internalId)}"
                                >
                                    Remove
                                </button>
                            </td>

                        </tr>
                    `;

                }
            ).join('');

        }

        // =================================================
        // SUCCESS LOG
        // =================================================

        console.log(
            'HMS DASHBOARD DATABASE LOAD SUCCESS',
            {
                statistics: stats,
                workflowCount: patients.length,
                visibleWorkflowCount: visiblePatients.length,
                generatedAt: data.generated_at
            }
        );

    } catch (error) {

        console.error(
            'HMS DASHBOARD DATABASE LOAD ERROR:',
            error
        );

        workflowTable.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    style="text-align:center;color:#dc2626;"
                >
                    Failed to load dashboard data.
                    Check the dashboard API and server logs.
                </td>
            </tr>
        `;

    }

}

// =========================================================
// REMOVE PATIENT FROM THE VISIBLE DASHBOARD TRACKER
// WITHOUT DELETING THE DATABASE RECORD
// =========================================================

document.addEventListener(
    'click',
    function (event) {

        const button = event.target.closest(
            '[data-dashboard-patient-id]'
        );

        if (!button) {
            return;
        }

        const patientId =
            button.dataset.dashboardPatientId;

        if (!patientId) {
            return;
        }

        const confirmed = confirm(
            'Remove this patient from the Live Patient Workflow Tracker? ' +
            'The patient and medical records will not be deleted.'
        );

        if (!confirmed) {
            return;
        }

        try {

            const hidden = JSON.parse(
                localStorage.getItem(
                    'hms_live_tracker_hidden_patients'
                ) || '[]'
            ).map(String);

            if (!hidden.includes(String(patientId))) {

                hidden.push(String(patientId));

            }

            localStorage.setItem(
                'hms_live_tracker_hidden_patients',
                JSON.stringify(hidden)
            );

            loadDashboardFromDatabase();

        } catch (error) {

            console.error(
                'Unable to update dashboard tracker visibility:',
                error
            );

            alert(
                'Unable to remove this patient from the visible tracker.'
            );

        }

    }
);

// =========================================================
// EXPORT FOR HMS MODULE SWITCHING
// =========================================================

window.loadDashboardFromDatabase =
    loadDashboardFromDatabase;


  // =======================================================
  // DYNAMIC SELECTS
  // =======================================================

  populateStaffDepartmentSelect();

  // =======================================================
  // TRIAGE PATIENT QUEUE
  // ALWAYS REBUILD FROM CURRENT HMS STATE
  // =======================================================

  loadTriagePatientQueue();


  // =======================================================
  // TRIAGE ASSIGNED CLINICAL DEPARTMENT / CLINIC
  // LOAD DIRECTLY FROM DATABASE
  // =======================================================

  loadTriageDepartments();
  
  // =======================================================
  // SURGEONS
  // =======================================================

  // =======================================================
// SURGEONS
// VALUE MUST BE THE REAL PostgreSQL staff.id
// =======================================================

const surgeonSelect =
  document.getElementById(
    'ot-surgeon'
  );

if (
  surgeonSelect
) {

  const previousSurgeon =
    surgeonSelect
      .value;

  surgeonSelect
    .innerHTML = `
    <option value="">
      Select Lead Surgeon
    </option>
  `;

  state
    .staff
    .filter(
      staff => {

        const role =
          String(
            staff.role || ''
          )
            .toLowerCase();

        return (
          role.includes(
            'doctor'
          ) ||
          role.includes(
            'surgeon'
          )
        );

      }
    )
    .forEach(
      staff => {

        const option =
          document.createElement(
            'option'
          );

        // REAL PostgreSQL staff.id
        option
          .value =
          String(
            staff.id
          );

        // HUMAN-READABLE NAME
        option
          .textContent =
          staff.name ||
          staff.full_name ||
          `Staff ${staff.id}`;

        surgeonSelect
          .appendChild(
            option
          );

      }
    );

  if (
    previousSurgeon &&
    [
      ...surgeonSelect.options
    ].some(
      option =>
        option.value ===
        String(
          previousSurgeon
        )
    )
  ) {

    surgeonSelect
      .value =
      String(
        previousSurgeon
      );

  }

}
  // Finance can retrieve the same patient's billing card at any point in
  // the care journey, not only when the patient reaches the final Billing Queue.
  // populateSelect includes the current phase in each option label.
  populateSelect(
    'acc-patient-select',
    patient => Boolean(patient && (patient.id || patient.databaseId || patient.patient_id)),
    preserveValue('acc-patient-select')
  );
  
  // =======================================================
  // OPD PATIENT CLINICAL RECORD
  // =======================================================

  
}

// =========================================================
// DOM HELPERS
// =========================================================
// =========================================================
// HMS AUDIT LOG HELPER
// =========================================================

function logAudit(message) {

    try {

        if (
            typeof state !== "undefined" &&
            Array.isArray(state.auditLog)
        ) {

            state.auditLog.push({
                message: message,
                timestamp: new Date().toISOString()
            });

        }

    } catch (error) {

        console.warn(
            "AUDIT LOG FAILED:",
            error
        );

    }
}


function setText(
  id,
  value
) {

  const element =
    document.getElementById(id);

  if (element) {

    element.innerText =
      value;

  }

}

function setHTML(
  id,
  value
) {

  const element =
    document.getElementById(id);

  if (element) {

    element.innerHTML =
      value;

  }

}

// =========================================================
// GET PATIENT FROM SELECT
// =========================================================

function getPatientFromSelect(
  id
) {

  const select =
    document.getElementById(id);

  if (!select || !select.value) {

    return null;

  }

  return state.patients.find(
    patient =>
      patient.id === select.value
  ) || null;

}

// =========================================================
// BACKUP
// =========================================================

function downloadBackup() {

  const backup = {

    exportedAt:
      new Date().toISOString(),

    version:
      'HMS-2.0',

    state:
      state

  };

  const json =
    JSON.stringify(
      backup,
      null,
      2
    );

  const blob =
    new Blob(
      [json],
      {
        type:
          'application/json'
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const anchor =
    document.createElement(
      'a'
    );

  anchor.href =
    url;

  anchor.download =
    `HMS_Backup_${
      new Date()
        .toISOString()
        .slice(0, 10)
    }.json`;

  document.body.appendChild(
    anchor
  );

  anchor.click();

  anchor.remove();

  URL.revokeObjectURL(
    url
  );

  logAudit(
    'Database backup created and downloaded.'
  );

}

function loadSelectedLabOrders() {

  const select =
    document.getElementById(
      'lab-patient-select'
    );

  const orderPanel =
    document.getElementById(
      'lab-doctor-orders'
    );

  if (!select || !orderPanel) {
    return;
  }

  const option =
    select.options[
      select.selectedIndex
    ];

  // Nothing selected
  if (
    !option ||
    !option.value
  ) {

    orderPanel.innerHTML = `
      <strong>Doctor's Laboratory Order:</strong>
      <span>Select a pending laboratory request.</span>
    `;

    return;
  }

  const patientName =
    option.dataset.patientName ||
    'Unknown Patient';

  const patientId =
    option.dataset.patientId ||
    'N/A';

  const requestId =
    option.dataset.requestId ||
    option.value;

  const testName =
    option.dataset.testName ||
    'Laboratory Test';

  const sampleType =
    option.dataset.sampleType ||
    '';

  const barcode =
    option.dataset.barcode ||
    '';

  orderPanel.innerHTML = `

    <strong>Doctor's Laboratory Order:</strong>

    <div style="
      margin-top:8px;
      display:grid;
      gap:5px;
    ">

      <div>
        <strong>Patient:</strong>
        ${escapeHTML(patientName)}
      </div>

      <div>
        <strong>Patient ID:</strong>
        ${escapeHTML(patientId)}
      </div>

      <div>
        <strong>Request ID:</strong>
        ${escapeHTML(requestId)}
      </div>

      <div>
        <strong>Investigation:</strong>
        ${escapeHTML(testName)}
      </div>

      ${
        sampleType
          ? `
            <div>
              <strong>Sample Type:</strong>
              ${escapeHTML(sampleType)}
            </div>
          `
          : ''
      }

    </div>

  `;

  const barcodeInput =
    document.getElementById(
      'lab-barcode'
    );

  if (barcodeInput) {
    barcodeInput.value =
      barcode;
  }

}

// =========================================================
// LABORATORY — DATABASE-BACKED
// PostgreSQL is the source of truth.
// NO state.patients.labOrders
// NO localStorage
// =========================================================

// =========================================================
// LOAD PENDING LABORATORY REQUESTS & DISPLAY SELECTED LABORATORY REQUEST 
//==========================================================
function updateLabPatientReleaseControl() {
  const select = document.getElementById('lab-release-patient-select');
  const button = document.getElementById('lab-release-patient-btn');
  const status = document.getElementById('lab-release-patient-status');
  if (!select || !button) return;
  const option = select.options[select.selectedIndex];
  const pending = Number(option?.dataset.pendingCount || 0);
  const hasPatient = Boolean(select.value);
  button.disabled = !hasPatient || pending > 0;
  if (status) {
    status.classList.remove('lab-release-success');
    status.textContent = !hasPatient
      ? (select.options.length > 1 ? 'Select a patient to check release readiness.' : 'No patients are currently waiting for release from Lab.')
      : pending > 0
        ? `Complete all ${pending} pending test${pending === 1 ? '' : 's'} before release.`
        : 'All requested tests are complete. This patient can be released to Doctor.';
  }
}

async function loadLabReleasePatients() {
  await hmsWaitForAuthRole();
  if (!hmsRoleMayCall('/api/laboratory/patients-for-release')) {
    const unavailable = document.getElementById('lab-release-patient-select');
    if (unavailable) unavailable.innerHTML = '<option value="">Laboratory release is not available for this account.</option>';
    updateLabPatientReleaseControl();
    return;
  }
  const select = document.getElementById('lab-release-patient-select');
  if (!select) return;
  const previousId = select.value;
  try {
    const response = await fetch('/api/laboratory/patients-for-release', {
      credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load Lab patients.');
    const patients = Array.isArray(data.patients) ? data.patients : [];
    select.innerHTML = '<option value="">-- Select Patient --</option>' + patients.map(patient =>
      `<option value="${escapeHTML(patient.id)}" data-pending-count="${Number(patient.pending_count) || 0}">${escapeHTML(patient.patient_id || '')} — ${escapeHTML(patient.full_name || 'Patient')} · ${Number(patient.pending_count) || 0} pending</option>`
    ).join('');
    if (patients.some(patient => String(patient.id) === previousId)) select.value = previousId;
    updateLabPatientReleaseControl();
  } catch (error) {
    select.innerHTML = '<option value="">Unable to load Lab patients</option>';
    updateLabPatientReleaseControl();
    const status = document.getElementById('lab-release-patient-status');
    if (status) status.textContent = error.message || 'Unable to load Lab patients.';
  }
}

async function releaseLabPatient() {
  const select = document.getElementById('lab-release-patient-select');
  const button = document.getElementById('lab-release-patient-btn');
  const status = document.getElementById('lab-release-patient-status');
  const patientId = select?.value;
  if (!patientId || !button || button.disabled) return;
  button.disabled = true;
  if (status) status.textContent = 'Releasing patient…';
  try {
    const response = await fetch(`/api/laboratory/patient/${encodeURIComponent(patientId)}/release`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to release patient.');
    const releaseMessage = data.message || 'Patient released to Doctor.';
    Array.from(select.options)
      .find(option => option.value === String(patientId))
      ?.remove();
    select.value = '';
    if (status) {
      status.textContent = releaseMessage;
      status.classList.add('lab-release-success');
    }
    await loadLabOrders();
    await loadLabReleasePatients();
    if (status) {
      status.textContent = releaseMessage;
      status.classList.add('lab-release-success');
    }
  } catch (error) {
    updateLabPatientReleaseControl();
    if (status) {
      status.textContent = error.message || 'Unable to release patient.';
      status.classList.remove('lab-release-success');
    }
  }
}

function initializeLabPatientRelease() {
  const select = document.getElementById('lab-release-patient-select');
  const button = document.getElementById('lab-release-patient-btn');
  if (!select || !button) return;
  select.addEventListener('change', updateLabPatientReleaseControl);
  button.addEventListener('click', releaseLabPatient);
  loadLabReleasePatients();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeLabPatientRelease, { once: true });
else initializeLabPatientRelease();

async function loadLabOrders() {

  const select =
    document.getElementById(
      'lab-patient-select'
    );

  const orderPanel =
    document.getElementById(
      'lab-doctor-orders'
    );

  if (!select) {
    return;
  }

  select.innerHTML =
    '<option value="">Loading laboratory requests...</option>';

  if (orderPanel) {
    orderPanel.innerHTML = `
      <strong>Doctor's Laboratory Order:</strong>
      <span>Select a pending laboratory request.</span>
    `;
  }

  try {

    const response =
      await fetch(
        '/api/laboratory/requests',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept': 'application/json'
          }
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data.error ||
        data.message ||
        'Unable to load laboratory requests.'
      );

    }

    const requests =
      Array.isArray(data)
        ? data
        : Array.isArray(data.requests)
          ? data.requests
          : [];

    select.innerHTML = `
      <option value="">
        -- Select Patient --
      </option>
    `;

    if (!requests.length) {

      select.innerHTML = `
        <option value="">
          No pending laboratory requests
        </option>
      `;

      if (orderPanel) {

        orderPanel.innerHTML = `
          <strong>Doctor's Laboratory Order:</strong>
          <span>No pending laboratory requests.</span>
        `;

      }

      return;
    }

    requests.forEach(
      item => {

        const option =
          document.createElement(
            'option'
          );

        option.value =
          String(item.id);

        option.dataset.requestId =
          item.request_id || '';

        option.dataset.patientId =
          item.patient_id || '';

        option.dataset.patientName =
          item.patient_name || '';

        option.dataset.testName =
          item.test_name || '';

        option.dataset.sampleType =
          item.sample_type || '';

        option.dataset.barcode =
          item.barcode || '';

        // ONLY PATIENT NAME IS SHOWN
        // IN THE SELECTION BAR
        option.textContent =
          item.patient_name ||
          'Unknown Patient';

        select.appendChild(
          option
        );

      }
    );

    // Nothing is selected automatically.
    select.value = '';

    // Handle selection directly.
    select.onchange =
      loadSelectedLabOrders;

  } catch (error) {

    console.error(
      'LABORATORY REQUEST LOAD ERROR:',
      error
    );

    select.innerHTML = `
      <option value="">
        Unable to load laboratory requests
      </option>
    `;

    if (orderPanel) {

      orderPanel.innerHTML = `
        <strong>Doctor's Laboratory Order:</strong>
        <span style="color:#dc2626;">
          ${escapeHTML(
            error.message ||
            'Unable to load laboratory requests.'
          )}
        </span>
      `;

    }

  }

}


function renderSelectedLabOrder() {

  const select =
    document.getElementById(
      'lab-patient-select'
    );

  const orderPanel =
    document.getElementById(
      'lab-doctor-orders'
    );

  if (!select || !orderPanel) {
    return;
  }

  const option =
    select.options[
      select.selectedIndex
    ];

  // -------------------------------------------------------
  // NOTHING SELECTED
  // -------------------------------------------------------

  if (
    !option ||
    !option.value
  ) {

    orderPanel.innerHTML = `
      <strong>Doctor's Laboratory Order:</strong>
      <span>Select a pending laboratory request.</span>
    `;

    return;
  }

  const patientName =
    option.dataset.patientName ||
    'Unknown Patient';

  const patientId =
    option.dataset.patientId ||
    'N/A';

  const requestId =
    option.dataset.requestId ||
    option.value;

  const testName =
    option.dataset.testName ||
    'Laboratory Test';

  const sampleType =
    option.dataset.sampleType ||
    '';

  const barcode =
    option.dataset.barcode ||
    '';

  // -------------------------------------------------------
  // SHOW SELECTED PATIENT'S LABORATORY ORDER
  // -------------------------------------------------------

  orderPanel.innerHTML = `

    <strong>Doctor's Laboratory Order:</strong>

    <div style="
      margin-top:8px;
      display:grid;
      gap:5px;
    ">

      <div>
        <strong>Patient:</strong>
        ${escapeHTML(patientName)}
      </div>

      <div>
        <strong>Patient ID:</strong>
        ${escapeHTML(patientId)}
      </div>

      <div>
        <strong>Request ID:</strong>
        ${escapeHTML(requestId)}
      </div>

      <div>
        <strong>Investigation:</strong>
        ${escapeHTML(testName)}
      </div>

      ${
        sampleType
          ? `
            <div>
              <strong>Sample Type:</strong>
              ${escapeHTML(sampleType)}
            </div>
          `
          : ''
      }

    </div>

  `;

  // -------------------------------------------------------
  // PREFILL DATABASE VALUES
  // -------------------------------------------------------

  const barcodeInput =
    document.getElementById(
      'lab-barcode'
    );

  if (barcodeInput) {

    barcodeInput.value =
      barcode;

  }

  const sampleSelect =
    document.getElementById(
      'lab-sample'
    );

  if (
    sampleSelect &&
    sampleType
  ) {

    const matchingOption =
      Array.from(
        sampleSelect.options
      ).find(
        option =>
          option.value
            .trim()
            .toLowerCase() ===
          sampleType
            .trim()
            .toLowerCase()
      );

    if (matchingOption) {

      sampleSelect.value =
        matchingOption.value;

    }

  }

}

//==========================================================
// SAVE LABORATORY RESULT
// =========================================================

async function saveLabResult(
  event
) {

  event.preventDefault();

  const select =
    document.getElementById(
      'lab-patient-select'
    );

  const requestId =
    select?.value;

  const barcode =
    document.getElementById(
      'lab-barcode'
    )?.value.trim() || '';

  const sampleType =
    document.getElementById(
      'lab-sample'
    )?.value || '';

  const verificationStatus =
    document.getElementById(
      'lab-status'
    )?.value || 'Pending Review';

  const results =
    document.getElementById(
      'lab-results'
    )?.value.trim() || '';

  // -------------------------------------------------------
  // VALIDATION
  // -------------------------------------------------------

  if (!requestId) {

    alert(
      'Select a pending laboratory request.'
    );

    return;
  }

  if (!results) {

    alert(
      'Enter laboratory results.'
    );

    return;
  }

  try {

    const response =
      await fetch(
        '/api/laboratory/results',
        {
          method: 'POST',

          credentials:
            'same-origin',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify({

              // PostgreSQL lab_requests.id
              request_id:
                Number(requestId),

              barcode:
                barcode || null,

              sample_type:
                sampleType || null,

              verification_status:
                verificationStatus,

              results:
                results

            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      data.success === false
    ) {

      throw new Error(
        data.error ||
        data.message ||
        'Unable to save laboratory result.'
      );

    }

    alert(
      data.message ||
      'Laboratory result saved. Patient remains in Lab until released.'
    );

    // -----------------------------------------------------
    // RESET RESULT FORM
    // -----------------------------------------------------

    if (event.target) {

      event.target.reset();

    }

    // -----------------------------------------------------
    // RELOAD DIRECTLY FROM POSTGRESQL
    //
    // Completed request disappears from the pending queue.
    // -----------------------------------------------------

    await loadLabOrders();
    await loadLabReleasePatients();

  } catch (error) {

    console.error(
      'LABORATORY RESULT SAVE ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to save laboratory result.'
    );

  }

}

// =========================================================
// AUTOMATIC EVENT HOOKS
// =========================================================

document.addEventListener(
  'change',
  function (event) {

    const id =
      event.target?.id;

    // =====================================================
    // DOCTOR PATIENT CHANGED
    // =====================================================

    if (
      id ===
      'doc-patient-select'
    ) {

      handleDoctorPatientChange();

    }
    
    // =====================================================
    // OPD PATIENT CHANGED
    // =====================================================

    if (
      id ===
      'opd-patient-select'
    ) {
      handleOPDPatientChange();

    }
    // =====================================================
    // NURSE PATIENT CHANGED
    // =====================================================

    if (
      id ===
      'nurse-patient-select'
    ) {

      loadNurseClinicalInformation();

    }

    // =====================================================
    // THEATRE PATIENT CHANGED
    // =====================================================

    if (
      id ===
      'ot-patient-select'
    ) {

      loadTheatreClinicalInformation();

    }

    // =====================================================
    // ACCOUNTS PATIENT CHANGED
    // =====================================================

    if (
      id ===
      'acc-patient-select'
    ) {

      loadAccountsPatient();

    }

    // =====================================================
    // MEDICAL REPORT PATIENT CHANGED
    // =====================================================

    if (
      id ===
      'opd-patient-select'
    ) {

      loadMedicalReportPatient();

    }

    // =====================================================
    // MEDICAL REPORT TYPE CHANGED
    // =====================================================

    if (
      id ===
      'medical-report-type'
    ) {

      if (
        window.currentOPDPatientData
      ) {

        renderFilteredMedicalReports(
          window.currentOPDPatientData
        );

      }

    }

  }
);

// =========================================================
// OPTIONAL GLOBAL FUNCTIONS
// These allow HTML onchange attributes to work.
// ========================================================

window.handleDoctorPatientChange =
  handleDoctorPatientChange;

window.switchHmsNestedTab =
  switchHmsNestedTab;

window.toggleDoctorRecordTabs =
  toggleDoctorRecordTabs;

window.openReceptionTriageAssessment =
  openReceptionTriageAssessment;

window.loadDoctorNursingRecords =
  loadDoctorNursingRecords;

window.renderDoctorClinicalProgress =
  renderDoctorClinicalProgress;

window.loadDoctorNursingReviewReports =
  loadDoctorNursingReviewReports;

window.acknowledgeDoctorNursingReview =
  acknowledgeDoctorNursingReview;

window.loadNurseClinicalInformation =
  loadNurseClinicalInformation;

window.loadTheatreClinicalInformation =
  loadTheatreClinicalInformation;

window.loadAccountsPatient =
  loadAccountsPatient;

window.printPatientCard =
  printPatientCard;

window.loadMedicalReportPatient =
  loadMedicalReportPatient;

window.renderFilteredMedicalReports =
  renderFilteredMedicalReports;

window.printMedicalReport =
  printMedicalReport;

window.downloadMedicalReportJSON =
  downloadMedicalReportJSON;

window.viewStoredMedicalReport =
  viewStoredMedicalReport;

window.processOPDSlidePayment =
  processOPDSlidePayment;

window.printOPDReceipt =
  printOPDReceipt;

window.printOPDMedicalJourney =
  printOPDMedicalJourney;

window.completeOPDPatient =
  completeOPDPatient;

window.advanceOPDReportSlide =
  advanceOPDReportSlide;

window.loadMedicalReportPatient =
  loadMedicalReportPatient;

window.renderFilteredMedicalReports =
  renderFilteredMedicalReports;

  window.handleOPDPatientChange =
  handleOPDPatientChange;

window.loadOPDPatients =
  loadOPDPatients;

window.loadOPDPatientSelector =
  loadOPDPatientSelector;
// =========================================================
// DATABASE-BACKED NURSING & INPATIENT WARD
// =========================================================

async function loadNurseBeds() {

  const select =
    document.getElementById('n-bed');

  if (!select) return;

  try {

    const response =
      await fetch(
        '/api/nursing/beds',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data.error ||
        'Unable to load available beds.'
      );

    }

    select.innerHTML = `
      <option value="">
        -- Select Available Bed --
      </option>
    `;

    data.forEach(bed => {

      const option =
        document.createElement('option');

      option.value =
        String(bed.id);

      option.textContent =
        bed.bed_number;

      select.appendChild(
        option
      );

    });

  } catch (error) {

    console.error(
      'NURSING BED LOAD ERROR:',
      error
    );

    select.innerHTML = `
      <option value="">
        Unable to load beds
      </option>
    `;

  }

}

// =========================================================
// SAVE NURSING CARE
// =========================================================

async function saveNurseCare(event) {

  event.preventDefault();

  const select =
    document.getElementById(
      'nurse-patient-select'
    );

  const hiddenPatient =
    document.getElementById(
      'nurse-patient-db-id'
    );
  
  const selectedOption =
    select?.selectedOptions?.[0];

  const isContinuedCare =
    selectedOption?.dataset.continuedPatient == 'true';
  
  let patientId =
    hiddenPatient?.value || '';

  const referralId =
    select?.value || '';

  if (!patientId) {

    try {

      const response =
        await fetch(
          '/api/nursing/referrals',
          {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
          }
        );

      const referrals =
        await response.json();

      const referral =
        referrals.find(
          item =>
            String(item.id) ===
            String(referralId)
        );

      if (referral) {

        patientId =
          referral.patient_id;

      }

    } catch (error) {

      console.error(
        'Unable to resolve nursing patient:',
        error
      );

    }

  }

  if (!patientId) {

    alert(
      'Please select a patient.'
    );

    return;

  }

  const bedSelect =
    document.getElementById(
      'n-bed'
    );

  const payload = {

    patient_id:
      Number(patientId),

    referral_id:
      referralId
        ? Number(referralId)
        : null,

    bed_id:
      bedSelect?.value
        ? Number(bedSelect.value)
        : null,

    assessment:
      document.getElementById(
        'n-assessment'
      )?.value.trim() || null,

    care_plan:
      document.getElementById(
        'n-care-plan'
      )?.value.trim() || null,

    interventions:
      document.getElementById(
        'n-proc'
      )?.value.trim() || null,

    medication_notes:
      document.getElementById(
        'n-med-admin'
      )?.value.trim() || null,

    vital_signs:
      document.getElementById(
        'n-monitoring'
      )?.value.trim() || null,

    patient_response:
      document.getElementById(
        'n-response'
      )?.value.trim() || null,

    shift:
      document.getElementById(
        'n-shift'
      )?.value || null,

    nursing_notes:
      document.getElementById(
        'n-notes'
      )?.value.trim() || null

  };

  try {

    const response =
      await fetch(
        '/api/nursing/care',
        {
          method: 'POST',

          credentials:
            'same-origin',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify(payload)
        }
      );

    const data =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {

      throw new Error(
        data.error ||
        'Unable to save nursing care.'
      );

    }

    alert(
      'Nursing care saved successfully.'
    );

    // Clear nursing fields
    document.getElementById(
      'n-assessment'
    ).value = '';

    document.getElementById(
      'n-care-plan'
    ).value = '';

    document.getElementById(
      'n-proc'
    ).value = '';

    document.getElementById(
      'n-med-admin'
    ).value = '';

    document.getElementById(
      'n-monitoring'
    ).value = '';

    document.getElementById(
      'n-response'
    ).value = '';

    document.getElementById(
      'n-shift'
    ).value = '';

    document.getElementById(
      'n-notes'
    ).value = '';

    // Clear hidden patient
    document.getElementById(
      'nurse-patient-db-id'
    ).value = '';

    // Clear the selected patient after saving, then return to Undercare Patients.
    const patientSelectAfterSave = document.getElementById('nurse-patient-select');
    if (patientSelectAfterSave) patientSelectAfterSave.value = '';
    const doctorInfoAfterSave = document.getElementById('nurse-doctor-information');
    if (doctorInfoAfterSave) doctorInfoAfterSave.innerHTML = "<strong>Doctor's Referral / Clinical Notes:</strong> <span>Select a patient to view doctor's notes.</span>";
    await loadNursePatients();
    await loadInpatientWardCare();
    const undercareButton = document.querySelector('#mod-nurse .sub-tabs button[onclick*="nurse-undercare-patients"]');
    switchHmsNestedTab(undercareButton, 'nurse-undercare-patients');

  } catch (error) {

    console.error(
      'SAVE NURSING CARE ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to save nursing care.'
    );

  }

}

// =========================================================
// INPATIENT WARD CARE
// DATABASE IS THE SOURCE OF TRUTH
// REVIEW DATE / REPORT / DOCTOR AUTHORIZATION
// =========================================================

async function loadInpatientWardCare() {

  const container =
    document.getElementById(
      'nurse-inpatient-list'
    );

  if (!container) {
    return;
  }

  /*
   * Show loading state immediately.
   */
  container.innerHTML = `
    <div
      style="
        padding:20px;
        text-align:center;
        color:#64748b;
      "
    >
      Loading inpatient patients...
    </div>
  `;

  try {

    const response =
      await fetch(
        '/api/nursing/inpatient',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const data =
      await response.json()
        .catch(() => []);

    if (!response.ok) {

      throw new Error(
        data?.error ||
        'Unable to load inpatient ward patients.'
      );

    }

    /*
     * Your nursing backend currently returns
     * the inpatient records directly as an array.
     *
     * This also safely accepts:
     *
     * {
     *   patients: [...]
     * }
     *
     * so the UI remains compatible if the
     * response wrapper is used.
     */
    const patients =
      Array.isArray(data)
        ? data
        : (
            Array.isArray(data?.patients)
              ? data.patients
              : []
          );

    /*
     * No occupied inpatient beds.
     */
    if (!patients.length) {

      container.innerHTML = `
        <div
          style="
            padding:20px;
            text-align:center;
            color:#64748b;
          "
        >
          No patients currently under
          inpatient ward care.
        </div>
      `;

      return;
    }

    /*
     * Render every inpatient patient.
     */
    container.innerHTML =
      patients
        .map(
          patient =>
            createNurseInpatientCard(
              patient
            )
        )
        .join('');

  } catch (error) {

    console.error(
      'INPATIENT WARD LOAD ERROR:',
      error
    );

    container.innerHTML = `
      <div
        style="
          color:#b91c1c;
          padding:15px;
          background:#fef2f2;
          border:1px solid #fecaca;
          border-radius:6px;
        "
      >
        <strong>
          Unable to load inpatient ward care.
        </strong>

        <br>

        <small>
          ${
            escapeHTML(
              error.message ||
              'Unknown error'
            )
          }
        </small>
      </div>
    `;

  }

}

// =========================================================
// CREATE INPATIENT WARD CARD
// REVIEW DATE + DOCTOR AUTHORIZATION
// =========================================================

function createNurseInpatientCard(
  patient
) {

  if (!patient) {
    return '';
  }

  const patientId =
    Number(
      patient.patient_id
    );

  const patientName =
    patient.patient_name ||
    '';

  const patientCode =
    patient.patient_code ||
    '';

  const bedNumber =
    patient.bed_number ||
    'Not allocated';

  const reviewDate =
    patient.review_date ||
    null;

  const reviewDue =
    patient.review_due === true;

  const reportStatus =
    String(
      patient.review_report_status ||
      ''
    ).toUpperCase();

  const releaseAuthorized =
    patient.release_authorized === true;

  const doctorResponse =
    patient.doctor_response ||
    '';

  const roundNotes = Array.isArray(patient.round_notes)
    ? patient.round_notes
    : [];
  const roundNotesHTML = roundNotes.length
    ? roundNotes.map(note => `
        <article class="nurse-card-round-note">
          <header><strong>${escapeHTML(note.doctor_name || 'Doctor')}</strong><time>${escapeHTML(note.created_at ? new Date(note.created_at).toLocaleString() : 'Date not recorded')}</time></header>
          <p>${escapeHTML(note.comment || '')}</p>
        </article>`).join('')
    : '<p class="hms-muted nurse-card-round-empty">No doctor rounds comments recorded for this patient.</p>';

  let reviewHTML = '';

  if (
    reviewDate &&
    !reviewDue
  ) {

    reviewHTML = `
      <button
        type="button"
        class="btn btn-secondary"
        disabled
        style="
          opacity:0.65;
          cursor:not-allowed;
        "
      >
        Review:
        ${escapeHTML(
          reviewDate
        )}
      </button>
    `;

  }

  else if (
    reviewDue &&
    (
      reportStatus === '' ||
      reportStatus === 'NONE'
    )
  ) {

    reviewHTML = `
      <button
        type="button"
        class="btn"
        style="
          background:#dc2626;
          color:#fff;
          border:1px solid #b91c1c;
          font-weight:bold;
        "
        onclick="
          openNurseReviewReport(
            ${patientId}
          )
        "
      >
        REVIEW DUE — WRITE REPORT TO DOCTOR
      </button>
    `;

  }

  else if (
    reviewDue &&
    reportStatus === 'PENDING'
  ) {

    reviewHTML = `
      <button
        type="button"
        class="btn btn-secondary"
        disabled
        style="
          opacity:0.8;
          cursor:not-allowed;
        "
      >
        REPORT SENT — AWAITING DOCTOR
      </button>
    `;

  }

  else if (
    reviewDue &&
    reportStatus === 'INSTRUCTIONS'
  ) {

    reviewHTML = `
      <div
        style="
          width:100%;
          max-width:100%;
          min-width:0;
          box-sizing:border-box;
          margin-top:4px;
          padding:10px;
          background:#fff7ed;
          border:1px solid #fdba74;
          border-radius:6px;
          overflow-wrap:anywhere;
        "
      >

        <strong>
          Doctor Instructions
        </strong>

        <div
          style="
            margin-top:6px;
            white-space:pre-wrap;
            overflow-wrap:anywhere;
          "
        >
          ${escapeHTML(
            doctorResponse ||
            "Follow the doctor's instructions and continue nursing care."
          )}
        </div>

        <button
          type="button"
          class="btn btn-primary"
          style="margin-top:10px;"
          onclick="
            openNurseReviewReport(
              ${patientId}
            )
          "
        >
          Send Updated Report to Doctor
        </button>

      </div>
    `;

  }

  else if (
    reviewDue &&
    releaseAuthorized &&
    reportStatus === 'ACKNOWLEDGED'
  ) {

    reviewHTML = `
      <button
        type="button"
        class="btn btn-primary"
        disabled
        style="
          opacity:0.8;
        "
      >
        Doctor Authorized Discharge
      </button>
    `;

  }

  else {

    reviewHTML = `
      <button
        type="button"
        class="btn btn-secondary"
        disabled
        style="
          opacity:0.65;
          cursor:not-allowed;
        "
      >
        No Review Scheduled
      </button>
    `;

  }

  // =======================================================
  // OPD RELEASE
  // =======================================================

  let releaseHTML = '';

  if (
    reviewDue &&
    !(
      releaseAuthorized &&
      reportStatus === 'ACKNOWLEDGED'
    )
  ) {

    releaseHTML = `
      <button
        type="button"
        class="btn btn-secondary"
        disabled
        style="
          opacity:0.55;
          cursor:not-allowed;
        "
        title="
          Doctor must explicitly authorize release to Finance.
        "
      >
        Await Doctor Authorization
      </button>
    `;

  }

  else {

    releaseHTML = `
      <button
        type="button"
        class="btn btn-secondary"
        onclick="
          releaseNursePatientToOPD(
            ${patientId}
          )
        "
      >
        Authorize Discharge
      </button>
    `;

  }

  // =======================================================
  // FINAL CARD
  // =======================================================

  return `

    <div
      class="card"
      data-nurse-patient-search="${escapeHTML((patientName + ' ' + patientCode).toLowerCase())}"
      style="
        margin-bottom:12px;
        border:1px solid #e2e8f0;
        min-width:0;
        max-width:100%;
        box-sizing:border-box;
      "
    >

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:15px;
          flex-wrap:wrap;
          min-width:0;
          max-width:100%;
        "
      >

        <div
          style="
            min-width:0;
            max-width:100%;
            overflow-wrap:anywhere;
          "
        >

          <strong>
            ${escapeHTML(
              patientName
            )}
          </strong>

          <br>

          <small>
            Patient:
            ${escapeHTML(
              patientCode
            )}
          </small>

          <br>

          <small>
            Bed:
            ${escapeHTML(
              bedNumber
            )}
          </small>

          ${
            reviewDate
              ? `
                <br>
                <small>
                  Doctor Review:
                  ${escapeHTML(
                    reviewDate
                  )}
                </small>
              `
              : ''
          }

          ${
            (
              releaseAuthorized &&
              reportStatus === 'ACKNOWLEDGED'
            )
              ? `
                <br>
                <small
                  style="
                    color:#15803d;
                    font-weight:bold;
                  "
                >
                  Doctor has explicitly authorized release to Finance.
                </small>
              `
              : ''
          }

        </div>

        <div
          style="
            display:flex;
            gap:8px;
            flex-wrap:wrap;
            align-items:center;
            min-width:0;
            max-width:100%;
          "
        >

          <button
            type="button"
            class="btn btn-primary"
            onclick="
              continueNurseCare(
                ${patientId}
              )
            "
          >
            Continue Care
          </button>

          <button
            type="button"
            class="btn btn-secondary nurse-round-comments-toggle"
            id="nurse-round-comments-toggle-${patientId}"
            aria-expanded="false"
            aria-controls="nurse-round-comments-${patientId}"
            onclick="toggleNursePatientRoundComments(${patientId})"
          >
            View Doctor Comments (${roundNotes.length})
          </button>

          ${reviewHTML}

          ${releaseHTML}

        </div>

      </div>

      <section class="nurse-card-round-notes" id="nurse-round-comments-${patientId}" aria-label="Doctor daily rounds comments for ${escapeHTML(patientName)}" hidden>
        <h4>Doctor Daily Rounds Comments</h4>
        <div class="nurse-card-round-notes-list">${roundNotesHTML}</div>
      </section>

    </div>

  `;

}

function toggleNursePatientRoundComments(patientId) {
  const section = document.getElementById(`nurse-round-comments-${Number(patientId)}`);
  const button = document.getElementById(`nurse-round-comments-toggle-${Number(patientId)}`);
  if (!section || !button) return;
  const willOpen = section.hidden;
  section.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
  button.textContent = willOpen ? 'Hide Doctor Comments' : `View Doctor Comments (${section.querySelectorAll('.nurse-card-round-note').length})`;
}

// =========================================================
// OPEN NURSE REVIEW REPORT
// =========================================================

async function openNurseReviewReport(
  patientId
) {

  if (!patientId) {

    alert(
      'Patient was not identified.'
    );

    return;

  }

  // -------------------------------------------------------
  // CREATE MODAL
  // -------------------------------------------------------

  const existing =
    document.getElementById(
      'nurse-review-report-modal'
    );

  if (existing) {
    existing.remove();
  }

  const modal =
    document.createElement(
      'div'
    );

  modal.id =
    'nurse-review-report-modal';

  modal.style.position =
    'fixed';

  modal.style.inset =
    '0';

  modal.style.background =
    'rgba(0,0,0,0.55)';

  modal.style.zIndex =
    '99999';

  modal.style.display =
    'flex';

  modal.style.alignItems =
    'center';

  modal.style.justifyContent =
    'center';

  modal.innerHTML = `

    <div
      style="
        width:min(600px,94vw);
        background:#fff;
        border-radius:8px;
        padding:20px;
        box-sizing:border-box;
        box-shadow:0 20px 50px rgba(0,0,0,0.25);
      "
    >

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
        "
      >

        <strong>
          Nursing Review Report
        </strong>

        <button
          type="button"
          onclick="
            document
              .getElementById(
                'nurse-review-report-modal'
              )
              ?.remove()
          "
          style="
            border:0;
            background:transparent;
            font-size:22px;
            cursor:pointer;
          "
        >
          ×
        </button>

      </div>

      <div
        style="
          margin-top:15px;
        "
      >

        <label
          for="nurse-review-report-text"
          style="
            display:block;
            font-weight:bold;
            margin-bottom:6px;
          "
        >
          Patient Follow-up Report
        </label>

        <textarea
          id="nurse-review-report-text"
          rows="8"
          style="
            width:100%;
            box-sizing:border-box;
            resize:vertical;
          "
          placeholder="Enter the patient's current nursing condition, progress, concerns, response to treatment, observations, and any information the doctor needs for review..."
        ></textarea>

      </div>

      <div
        style="
          margin-top:15px;
          display:flex;
          justify-content:flex-end;
          gap:8px;
        "
      >

        <button
          type="button"
          class="btn btn-secondary"
          onclick="
            document
              .getElementById(
                'nurse-review-report-modal'
              )
              ?.remove()
          "
        >
          Cancel
        </button>

        <button
          type="button"
          class="btn btn-primary"
          onclick="
            submitNurseReviewReport(
              ${Number(patientId)}
            )
          "
        >
          Save Follow-up Report
        </button>

      </div>

    </div>

  `;

  document.body.appendChild(
    modal
  );

  document
    .getElementById(
      'nurse-review-report-text'
    )
    ?.focus();

}

// =========================================================
// SUBMIT NURSE REVIEW REPORT
// =========================================================

async function submitNurseReviewReport(
  patientId
) {

  const textarea =
    document.getElementById(
      'nurse-review-report-text'
    );

  const report =
    textarea?.value.trim() || '';

  if (!report) {

    alert(
      'Enter the nursing follow-up report before saving it.'
    );

    textarea?.focus();

    return;

  }

  try {

    const response =
      await fetch(
        '/api/nursing/review-report',
        {
          method: 'POST',

          credentials:
            'same-origin',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify({
              patient_id:
                Number(patientId),

              report:
                report
            })
        }
      );

    const data =
      await response.json()
        .catch(() => ({}));

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        data.message ||
        'Unable to save nursing follow-up report.'
      );

    }

    document
      .getElementById(
        'nurse-review-report-modal'
      )
      ?.remove();

    alert(
      data.message ||
      'Nursing follow-up report saved for doctor review.'
    );

    // -----------------------------------------------------
    // DATABASE IS NOW THE SOURCE OF TRUTH
    // -----------------------------------------------------

    await loadInpatientWardCare();

  } catch (error) {

    console.error(
      'NURSE REVIEW REPORT ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to save nursing follow-up report for doctor review.'
    );

  }

}

// =========================================================
// NURSE INPATIENT CARD
// COMPACT RESPONSIVE DOCTOR/NURSE COMMUNICATION
// =========================================================

// =========================================================
// DOCTOR NURSING REVIEW REPORTS
//
// Nurses send review reports through:
// POST /api/nursing/review-report
//
// Doctors receive them through:
// GET /api/nursing/review-reports
//
// The visible Doctor Follow-up & Referral section is:
// #doctor-followup-reports
// =========================================================

async function loadDoctorNursingReviewReports() {

    // -------------------------------------------------------
    // FIND THE EXISTING REPORTS CONTAINER
    // -------------------------------------------------------

    let container =
        document.getElementById(
            'doctor-followup-reports'
        );

    if (
        !container
    ) {
        container =
            document.getElementById(
                'doctor-nursing-review-reports'
            );
    }

    // -------------------------------------------------------
    // FIND DOCTOR MODULE
    // -------------------------------------------------------

    const doctorModule =
        document.getElementById(
            'mod-doctor'
        );

    if (
        !container &&
        !doctorModule
    ) {
        return;
    }

    // -------------------------------------------------------
    // CREATE CONTAINER BELOW THE CONSULTATION FORM
    // -------------------------------------------------------

    if (
        !container
    ) {

        container = document.createElement(
            'div'
        );

        container.id = 'doctor-nursing-review-reports';

        container.style.marginTop = '20px';
        container.style.marginBottom = '15px';
        container.style.minWidth = '0';
        container.style.maxWidth = '100%';

        /*
         * Place reports after the consultation form so that
         * Save Doctor Consultation appears first.
         *
         * If no identifiable form is found, append the reports
         * to the Doctor module instead of prepending them.
         */

        const nursingTab =
            document.getElementById('doc-record-nursing');

        if (nursingTab) {
            nursingTab.appendChild(container);
        } else {
            const consultationForm =
                doctorModule.querySelector(
                    'form:has(#d-hpi), form:has(#d-final-diag)'
                );

            if (consultationForm) {
                consultationForm.insertAdjacentElement('afterend', container);
            } else {
                doctorModule.appendChild(container);
            }
        }
    }

    // -------------------------------------------------------
    // LOADING MESSAGE
    // -------------------------------------------------------

    container.innerHTML = `
        <div style="
            margin-top:20px;
            padding:15px;
            border:1px solid #cbd5e1;
            border-radius:6px;
            background:#f8fafc;
            box-sizing:border-box;
            max-width:100%;
        ">
            <div style="
                font-weight:700;
                margin-bottom:10px;
            ">
                Nursing Follow-up Reports
            </div>

            <div style="color:#64748b;">
                Loading nursing follow-up reports...
            </div>
        </div>
    `;

    try {

        // ---------------------------------------------------
        // LOAD REPORTS
        // ---------------------------------------------------

        const response = await fetch(
            '/api/nursing/review-reports',
            {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        const data = await response.json().catch(
            () => (
                {}
            )
        );

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.error ||
                data.message ||
                'Unable to load nursing follow-up reports.'
            );
        }

        let reports = Array.isArray(data.reports) ? data.reports : [];
        const selectedPatientId = document.getElementById('doc-patient-select')?.value || '';
        if (!selectedPatientId) reports = [];
        else reports = reports.filter(report => String(report.patient_id ?? report.patient_db_id ?? report.patient?.id ?? '') === String(selectedPatientId));

        // ---------------------------------------------------
        // NO REPORTS
        // ---------------------------------------------------

        if (
            !reports.length
        ) {

            container.innerHTML = `
                <div style="
                    margin-top:20px;
                    padding:15px;
                    border:1px solid #cbd5e1;
                    border-radius:6px;
                    background:#f8fafc;
                    box-sizing:border-box;
                    max-width:100%;
                ">
                    <div style="
                        font-weight:700;
                        margin-bottom:10px;
                    ">
                        Nursing Follow-up Reports
                    </div>

                    <div style="color:#64748b;">
                        No nursing follow-up reports are waiting
                        for acknowledgement.
                    </div>
                </div>
            `;

            return;
        }

        // ---------------------------------------------------
        // DISPLAY REPORTS
        // ---------------------------------------------------

        container.innerHTML = `
            <div style="
                margin-top:20px;
                padding:15px;
                border:2px solid #f59e0b;
                border-radius:6px;
                background:#fffbeb;
                min-width:0;
                max-width:100%;
                box-sizing:border-box;
            ">
                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:10px;
                    flex-wrap:wrap;
                    min-width:0;
                ">
                    <div style="
                        font-weight:700;
                        min-width:0;
                    ">
                        Nursing Follow-up Reports
                    </div>

                    <span style="
                        padding:5px 10px;
                        border-radius:12px;
                        background:#dc2626;
                        color:#fff;
                        font-size:12px;
                        font-weight:700;
                    ">
                        ${reports.length} PENDING
                    </span>
                </div>

                <div style="
                    margin-top:12px;
                    min-width:0;
                    max-width:100%;
                ">
                    ${
                        reports.map(
                            report =>
                                createDoctorNursingReviewReportCard(
                                    report
                                )
                        ).join(
                            ''
                        )
                    }
                </div>
            </div>
        `;

    } catch (
        error
    ) {

        console.error(
            'DOCTOR REVIEW REPORT LOAD ERROR:',
            error
        );

        container.innerHTML = `
            <div style="
                margin-top:20px;
                padding:15px;
                border:1px solid #fecaca;
                border-radius:6px;
                background:#fef2f2;
                color:#991b1b;
                min-width:0;
                max-width:100%;
                box-sizing:border-box;
            ">
                <div style="
                    font-weight:700;
                    margin-bottom:8px;
                ">
                    Nursing Follow-up Reports
                </div>

                <div style="overflow-wrap:anywhere;">
                    ${
                        escapeHTML(
                            error.message ||
                            'Unable to load nursing follow-up reports.'
                        )
                    }
                </div>
            </div>
        `;
    }
}

// =========================================================
// CONTINUE CARE FOR AN INPATIENT
// START A NEW NURSING SESSION
// PUT PATIENT BACK INTO PATIENT SELECTION
// KEEP THE CURRENT OCCUPIED BED
// =========================================================

async function continueNurseCare(patientId) {

  if (!patientId) {

    alert(
      'Unable to continue nursing care: patient not found.'
    );

    return;
  }

  const hiddenPatient =
    document.getElementById(
      'nurse-patient-db-id'
    );

  const patientSelect =
    document.getElementById(
      'nurse-patient-select'
    );

  const bedSelect =
    document.getElementById(
      'n-bed'
    );

  if (!patientSelect) {

    alert(
      'Nursing patient selection control was not found.'
    );

    return;
  }

  try {

    // =====================================================
    // GET CURRENT INPATIENT DATA FROM DATABASE
    // =====================================================

    const response =
      await fetch(
        '/api/nursing/inpatient',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept':
              'application/json'
          }
        }
      );

    const patients =
      await response.json()
        .catch(() => []);

    if (!response.ok) {

      throw new Error(
        'Unable to load the current inpatient patient.'
      );

    }

    const patient =
      patients.find(
        item =>
          String(item.patient_id) ===
          String(patientId)
      );

    if (!patient) {

      throw new Error(
        'This patient is no longer under inpatient ward care.'
      );

    }

    // =====================================================
    // STORE DATABASE PATIENT ID
    // =====================================================

    if (hiddenPatient) {

      hiddenPatient.value =
        String(patient.patient_id);

    }

    // =====================================================
    // PUT PATIENT INTO THE VISIBLE PATIENT SELECTION
    // =====================================================

    // Remove an older temporary continued-care option.
    Array.from(
      patientSelect.options
    ).forEach(
      option => {

        if (
          option.dataset.continuedPatient ===
          'true'
        ) {

          option.remove();

        }

      }
    );

    const continuedOption =
      document.createElement(
        'option'
      );

    continuedOption.value =
      `continued:${patient.patient_id}`;

    continuedOption.textContent =
      `${patient.patient_code} - ${patient.patient_name} (Continued Care)`;

    continuedOption.dataset.continuedPatient =
      'true';

    continuedOption.dataset.patientId =
      String(patient.patient_id);

    patientSelect.appendChild(
      continuedOption
    );

    patientSelect.value =
      continuedOption.value;

    // =====================================================
    // PUT THE CURRENT OCCUPIED BED INTO BED SELECTION
    // =====================================================

    if (
      bedSelect &&
      patient.bed_id
    ) {

      const currentBedId =
        String(patient.bed_id);

      let bedOption =
        Array.from(
          bedSelect.options
        ).find(
          option =>
            String(option.value) ===
            currentBedId
        );

      if (!bedOption) {

        bedOption =
          document.createElement(
            'option'
          );

        bedOption.value =
          currentBedId;

        bedOption.textContent =
          `${patient.bed_number} (Current Bed)`;

        bedSelect.appendChild(
          bedOption
        );

      }

      bedSelect.value =
        currentBedId;

    }

    // =====================================================
    // CLEAR ONLY THE PREVIOUS SESSION'S CLINICAL DATA
    // =====================================================

    const fields = [

      'n-assessment',
      'n-care-plan',
      'n-proc',
      'n-med-admin',
      'n-monitoring',
      'n-response',
      'n-shift',
      'n-notes'

    ];

    fields.forEach(
      fieldId => {

        const field =
          document.getElementById(
            fieldId
          );

        if (field) {

          field.value = '';

        }

      }
    );

    // =====================================================
    // SHOW CONTINUED-CARE INFORMATION
    // =====================================================

    const doctorInfo =
      document.getElementById(
        'nurse-doctor-information'
      );

    if (doctorInfo) {

      doctorInfo.innerHTML = `

        <div
          class="clinical-doctor-information"
          style="
            padding:12px;
            border:1px solid #dbeafe;
            border-radius:6px;
          "
        >

          <strong>
            Continued Nursing Care
          </strong>

          <br>

          <span>
            Patient:
            ${escapeHTML(
              patient.patient_name || ''
            )}
          </span>

          <br>

          <span>
            Current Bed:
            ${escapeHTML(
              patient.bed_number || ''
            )}
          </span>

          <br>

          <small>
            A new nursing session will be created when
            Nursing Care is saved.
          </small>

        </div>

      `;

    }

    // =====================================================
    // FOCUS FIRST FIELD
    // =====================================================

    // Take the nurse directly to the nursing-record form.
    const nurseModule = document.getElementById('mod-nurse');
    const newPatientsTabButton = nurseModule?.querySelector('.sub-tabs button[onclick*="nurse-new-patients"]');
    switchHmsNestedTab(newPatientsTabButton, 'nurse-new-patients');
    const nurseTitle = document.getElementById('current-module-title');
    if (nurseTitle) nurseTitle.textContent = 'Inpatient Nursing Record';
    document.getElementById('n-assessment')?.focus();

  }

  catch (error) {

    console.error(
      'CONTINUE NURSING CARE ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to continue nursing care.'
    );

  }

}

// =========================================================
// RELEASE TO OPD
//
// IMPORTANT:
// The backend is authoritative.
//
// If the review date is due and the doctor has not
// acknowledged the nursing report, the backend returns 403.
// =========================================================

async function releaseNursePatientToOPD(
  patientId
) {

  if (!patientId) {

    alert(
      'Unable to release patient: patient not found.'
    );

    return;

  }

  if (
    !confirm(
      'Authorize this patient for discharge from inpatient ward care to Finance?'
    )
  ) {

    return;

  }

  try {

    const response =
      await fetch(
        `/api/nursing/release-to-opd/${encodeURIComponent(patientId)}`,
        {
          method:
            'POST',

          credentials:
            'same-origin',

          headers: {

            'Accept':
              'application/json'

          }

        }
      );

    const data =
      await response.json()
        .catch(
          () => ({})
        );

    // =====================================================
    // DOCTOR AUTHORIZATION REQUIRED
    // =====================================================

    if (
      response.status === 403 &&
      data.release_authorized === false
    ) {

      alert(
        data.error ||
        'Doctor authorization is required before this patient can be released to Finance.'
      );

      await loadInpatientWardCare();

      return;

    }

    if (!response.ok) {

      throw new Error(
        data.error ||
        data.message ||
        'Unable to release patient to Finance.'
      );

    }

    alert(
      data.message ||
      'Patient released to Finance for discharge.'
    );

    // =====================================================
    // DATABASE IS THE SOURCE OF TRUTH
    // =====================================================

    await loadInpatientWardCare();

    await loadNurseBeds();

    await loadNursePatients();

  }

  catch (error) {

    console.error(
      'RELEASE TO OPD ERROR:',
      error
    );

    alert(
      error.message ||
      'Unable to release patient to Finance.'
    );

  }

}

// =========================================================
// EXPORT FUNCTIONS
// =========================================================

window.saveNurseCare =
  saveNurseCare;

window.loadDoctorNursingReviewReports =
  loadDoctorNursingReviewReports;

window.loadNurseBeds =
  loadNurseBeds;

window.loadInpatientWardCare =
  loadInpatientWardCare;

window.continueNurseCare =
  continueNurseCare;

window.releaseNursePatientToOPD =
  releaseNursePatientToOPD;

window.openNurseReviewReport =
  openNurseReviewReport;

window.submitNurseReviewReport =
  submitNurseReviewReport;

window.createNurseInpatientCard =
  createNurseInpatientCard;

// ---------------------------------------------------------
// 3. SERVICE TARRIF / BILLING FEED INTEGRATION
// ---------------------------------------------------------
function addServiceToPatientBill(patientId, serviceName, fee) {
  const patient = state.patients.find(item => item.id === patientId);
  if (!patient) return;

  const charge = parseFloat(fee) || 0;
  patient.bill = Number(patient.bill || 0) + charge;
  patient.balance = Math.max(0, Number(patient.bill) - Number(patient.amountPaid || 0));

  if (!Array.isArray(patient.billingFeed)) {
    patient.billingFeed = [];
  }

  patient.billingFeed.push({
    type: 'charge',
    department: 'Service/Tariff',
    description: serviceName,
    amount: charge,
    date: new Date().toISOString()
  });

  logAudit(`Billed ${money(charge)} (${serviceName}) to patient ${patient.id}`);
}

// ---------------------------------------------------------
// 4. RESTORE MISSING PATIENT ATTRIBUTES ON INITIALIZATION
// ---------------------------------------------------------
(function patchExistingPatients() {
  if (Array.isArray(state.patients)) {
    state.patients.forEach(patient => {
      if (!Array.isArray(patient.labOrders)) patient.labOrders = [];
      if (!Array.isArray(patient.radiologyOrders)) patient.radiologyOrders = [];
      if (!Array.isArray(patient.doctorNotes)) patient.doctorNotes = [];
      if (!Array.isArray(patient.doctorNotifications)) patient.doctorNotifications = [];
      if (!Array.isArray(patient.laboratoryHistory)) patient.laboratoryHistory = [];
      if (!Array.isArray(patient.radiologyHistory)) patient.radiologyHistory = [];
      if (!Array.isArray(patient.nursingHistory)) patient.nursingHistory = [];
      if (!Array.isArray(patient.theatreHistory)) patient.theatreHistory = [];
      if (!Array.isArray(patient.paymentHistory)) patient.paymentHistory = [];
      if (!Array.isArray(patient.medications)) patient.medications = [];
      if (!Array.isArray(patient.billingFeed)) patient.billingFeed = [];
      if (!Array.isArray(patient.reports)) patient.reports = [];
    });
  }
})();

// ---------------------------------------------------------
// 5. AUTO-CALCULATE BILLING BALANCE DISCOUNTS
// ---------------------------------------------------------
document.addEventListener('input', function (event) {
  if (event.target && (event.target.id === 'acc-discount' || event.target.id === 'acc-amount')) {
    if (typeof calcBill === 'function') {
      calcBill();
    }
  }
});

// ---------------------------------------------------------
// 6. GLOBAL HOOK EXPORTS
// --------------------------------------------------------
window.addServiceToPatientBill = addServiceToPatientBill;

// =========================================================
// END HMS PATCH & INTEGRATION EXTENSION
// =========================================================

// =========================================================
// HMS ENHANCED FEATURES & UTILITIES EXTENSION
// Add below existing patch extension
// =========================================================

// ---------------------------------------------------------
// 1. LOCALSTORAGE AUTO-SAVE & RESTORE SYSTEM
// ---------------------------------------------------------
const STORAGE_KEY = 'HMS_SYSTEM_STATE_V2';

function saveSystemState() {
  if (!state.settings.autoSave) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save state to LocalStorage:', error);
  }
}

function restoreSystemState() {

  try {

    const savedData =
      localStorage.getItem(STORAGE_KEY);

    if (savedData) {

      const parsed =
        JSON.parse(savedData);

      // Preserve the current navigation
      const currentModules =
        state.modules;

// Restore saved system data
Object.assign(
  state,
  parsed
);

// =========================================================
// RESTORE STATE SAFETY
// Configuration collections MUST remain arrays.
// Old/corrupt LocalStorage data must not break HMS startup.
// =========================================================

if (!state.config || typeof state.config !== 'object') {
  state.config = {};
}

if (!Array.isArray(state.config.departments)) {
  state.config.departments = [];
}

if (!Array.isArray(state.config.wards)) {
  state.config.wards = [];
}

if (!Array.isArray(state.config.services)) {
  state.config.services = [];
}

// Restore the current navigation
state.modules =
  currentModules;

      logAudit(
        'System state restored from local storage.'
      );

    }

  } catch (error) {

    console.error(
      'Failed to restore state from LocalStorage:',
      error
    );

  }

}

// ---------------------------------------------------------
// 2. GLOBAL SYSTEM SEARCH & QUICK-ROUTING ENGINE
// ---------------------------------------------------------
function globalSearch(query) {
  const searchTerm = String(query).toLowerCase().trim();
  if (!searchTerm) return [];

  const matchedPatients = state.patients.filter(patient => 
    patient.id.toLowerCase().includes(searchTerm) ||
    patient.name.toLowerCase().includes(searchTerm) ||
    patient.phone.includes(searchTerm)
  );

  const matchedInventory = state.inventory.filter(item =>
    item.code.toLowerCase().includes(searchTerm) ||
    item.name.toLowerCase().includes(searchTerm)
  );

  return {
    patients: matchedPatients,
    inventory: matchedInventory
  };
}

// ---------------------------------------------------------
// 3. EMERGENCY (P1) OVERRIDE & TRIAGE FAST-TRACK
// ---------------------------------------------------------
function triggerEmergencyTriage(patientId) {
  const patient = state.patients.find(item => item.id === patientId);
  if (!patient) return;

  if (!patient.vitals) patient.vitals = {};
  patient.vitals.priority = 'P1 - Immediate (Resuscitation)';
  patient.phase = 'Doctor Queue';

  logAudit(`EMERGENCY OVERRIDE: Patient ${patient.id} priority updated to P1.`);
  alert(`Emergency Override Triggered for ${patient.name}. Routed directly to Doctor Queue.`);
  refreshUI();
}

// ---------------------------------------------------------
// 4. BATCH BILLING DISCHARGED PATIENTS ENGINES
// ---------------------------------------------------------
function clearZeroBalanceAccounts() {
  let clearedCount = 0;
  state.patients.forEach(patient => {
    if (patient.phase === 'Completed' || (patient.balance <= 0 && patient.phase === 'Discharged / Billing')) {
      patient.phase = 'Completed';
      clearedCount++;
    }
  });

  logAudit(`Batch billing processed. ${clearedCount} patient files finalized.`);
  refreshUI();
}

// ---------------------------------------------------------
// 5. DATA SANITIZATION & DUPLICATE CLEANUP
// ---------------------------------------------------------
function sanitizeSystemState() {
  state.patients = state.patients.filter((patient, index, self) =>
    index === self.findIndex(p => p.id === patient.id)
  );
  
  state.inventory = state.inventory.filter((item, index, self) =>
    index === self.findIndex(i => i.code === item.code)
  );

  logAudit('System data sanitized. Duplicate records removed.');
  refreshUI();
}

// ---------------------------------------------------------
// 6. AUTOMATED AUDIT LOG ROTATION & CLEANUP
// ---------------------------------------------------------
function purgeOldAuditLogs(maxLogs = 200) {
  if (state.auditLogs.length > maxLogs) {
    const removedCount = state.auditLogs.length - maxLogs;
    state.auditLogs = state.auditLogs.slice(0, maxLogs);
    logAudit(`Audit log auto-purged: ${removedCount} old entries removed.`);
  }
}

// ---------------------------------------------------------
// 7. EVENT HOOKS & PERSISTENCE
// ---------------------------------------------------------
window.addEventListener('beforeunload', saveSystemState);

// Wrap original refreshUI to save state automatically on changes
const originalRefreshUI = window.refreshUI || refreshUI;
window.refreshUI = function() {
  originalRefreshUI();
  saveSystemState();
};

// ---------------------------------------------------------
// 8. GLOBAL EXPORTS
// ---------------------------------------------------------
window.saveSystemState = saveSystemState;
window.restoreSystemState = restoreSystemState;
window.globalSearch = globalSearch;
window.triggerEmergencyTriage = triggerEmergencyTriage;
window.clearZeroBalanceAccounts = clearZeroBalanceAccounts;
window.sanitizeSystemState = sanitizeSystemState;
window.purgeOldAuditLogs = purgeOldAuditLogs;

// Auto-restore state on script load
restoreSystemState();

// =========================================================
// HMS LIVE TRACKER SAFE DELETE
// =========================================================
// IMPORTANT:
// This does NOT delete the patient from the hospital system.
// It only removes the patient from the Live Patient Workflow Tracker.
// The patient remains available in Administration, OPD/Medical Reports,
// history, billing, laboratory, radiology, nursing, theatre, etc.
// =========================================================

(function () {
  'use strict';

  const LIVE_TRACKER_KEY = 'hms_live_tracker_hidden_patients';

  function getHiddenLiveTrackerPatients() {
    try {
      return JSON.parse(
        localStorage.getItem(LIVE_TRACKER_KEY) || '[]'
      );
    } catch (error) {
      return [];
    }
  }

  function saveHiddenLiveTrackerPatients(ids) {
    localStorage.setItem(
      LIVE_TRACKER_KEY,
      JSON.stringify(ids)
    );
  }

  window.removePatientFromLiveTracker = function (patientId) {

    if (!patientId) return;

    const patient = state.patients.find(
      p => p.id === patientId
    );

    if (!patient) {
      alert('Patient record could not be found.');
      return;
    }

    const confirmed = confirm(
      `Remove ${patient.name} (${patient.id}) from the Live Patient Workflow Tracker?\n\n` +
      `IMPORTANT: This will NOT delete the patient from the hospital system.\n` +
      `The patient's complete medical record will remain available.`
    );

    if (!confirmed) return;

    const hidden =
      getHiddenLiveTrackerPatients();

    if (!hidden.includes(patientId)) {
      hidden.push(patientId);
    }

    saveHiddenLiveTrackerPatients(hidden);

    // Keep patient record completely intact.
    patient.liveTrackerVisible = false;

    logAudit(
      `Patient ${patient.id} removed from Live Patient Workflow Tracker only.`
    );

    refreshUI();
  };

  window.restorePatientToLiveTracker = function (patientId) {

    const patient = state.patients.find(
      p => p.id === patientId
    );

    if (!patient) return;

    const hidden =
      getHiddenLiveTrackerPatients()
        .filter(id => id !== patientId);

    saveHiddenLiveTrackerPatients(hidden);

    patient.liveTrackerVisible = true;

    logAudit(
      `Patient ${patient.id} restored to Live Patient Workflow Tracker.`
    );

    refreshUI();
  };

  window.isPatientHiddenFromLiveTracker = function (patient) {

    if (!patient) return false;

    const hidden =
      getHiddenLiveTrackerPatients();

    return (
      patient.liveTrackerVisible === false ||
      hidden.includes(patient.id)
    );
  };

})();

// =========================================================
// COMPLETE PATIENT CLINICAL JOURNEY
// =========================================================

window.buildCompletePatientJourney = function (patient) {

  if (!patient) {
    return [];
  }

  const journey = [];

  // -------------------------------------------------------
  // 1. REGISTRATION
  // -------------------------------------------------------

  journey.push({
    stage: 'Registration',
    date: patient.createdAt || '',
    details: [
      `Patient ID: ${patient.id || ''}`,
      `Name: ${patient.name || ''}`,
      `Date of Birth: ${patient.dob || ''}`,
      `Gender: ${patient.gender || ''}`,
      `Phone: ${patient.phone || ''}`,
      `Clinic: ${patient.clinic || ''}`
    ]
  });

  // -------------------------------------------------------
  // 2. TRIAGE
  // -------------------------------------------------------

  if (patient.vitals) {

    journey.push({
      stage: 'Triage Assessment',
      date: patient.vitals.date || '',
      details: [
        `Weight: ${patient.vitals.weight || 'N/A'} kg`,
        `Height: ${patient.vitals.height || 'N/A'} cm`,
        `BMI: ${patient.vitals.bmi || 'N/A'}`,
        `Blood Pressure: ${patient.vitals.bp || 'N/A'}`,
        `Temperature: ${patient.vitals.temp || 'N/A'} °C`,
        `Pulse: ${patient.vitals.pulse || 'N/A'} bpm`,
        `Respiratory Rate: ${patient.vitals.rr || 'N/A'}/min`,
        `SpO2: ${patient.vitals.spo2 || 'N/A'}%`,
        `Blood Sugar: ${patient.vitals.bs || 'N/A'}`,
        `Pain Score: ${patient.vitals.pain || 'N/A'}`,
        `Priority: ${patient.vitals.priority || 'N/A'}`,
        `Chief Complaint: ${patient.vitals.complaint || 'N/A'}`
      ]
    });

  }

  // -------------------------------------------------------
  // 3. DOCTOR
  // -------------------------------------------------------

  if (patient.doctorHistory) {

    journey.push({
      stage: 'Doctor Consultation',
      date: patient.doctorHistory.date || '',
      details: [
        `HPI: ${patient.doctorHistory.hpi || 'N/A'}`,
        `Past History: ${patient.doctorHistory.pastHistory || 'N/A'}`,
        `Examination: ${patient.doctorHistory.examination || 'N/A'}`,
        `Social / Family History: ${patient.doctorHistory.socialFamilyHistory || 'N/A'}`,
        `Provisional Diagnosis: ${patient.doctorHistory.provisionalDiagnosis || 'N/A'}`,
        `Differential Diagnosis: ${patient.doctorHistory.differentialDiagnosis || 'N/A'}`,
        `Final Diagnosis: ${patient.diagnosis || 'N/A'}`
      ]
    });

  }

  // -------------------------------------------------------
  // 4. DOCTOR NOTES
  // -------------------------------------------------------

  (patient.doctorNotes || []).forEach(note => {

    journey.push({
      stage: 'Doctor Clinical Note',
      date: note.date || '',
      details: [
        note.note || ''
      ]
    });

  });

  // -------------------------------------------------------
  // 5. LABORATORY
  // -------------------------------------------------------

  (patient.laboratoryHistory || []).forEach(result => {

    journey.push({
      stage: 'Laboratory',
      date: result.date || '',
      details: [
        `Sample Type: ${result.sampleType || 'N/A'}`,
        `Barcode: ${result.barcode || 'N/A'}`,
        `Status: ${result.status || 'N/A'}`,
        `Result: ${result.result || 'N/A'}`
      ]
    });

  });

  // -------------------------------------------------------
  // 6. RADIOLOGY
  // -------------------------------------------------------

  (patient.radiologyHistory || []).forEach(result => {

    journey.push({
      stage: 'Radiology',
      date: result.date || '',
      details: [
        `Findings: ${result.findings || result.result || 'N/A'}`,
        `Status: ${result.status || 'N/A'}`
      ]
    });

  });

  // -------------------------------------------------------
  // 7. PHARMACY
  // -------------------------------------------------------

  (patient.medications || []).forEach(medication => {

    journey.push({
      stage: 'Pharmacy',
      date: medication.date || '',
      details: [
        `Medication: ${medication.drug || medication.name || 'N/A'}`,
        `Quantity: ${medication.quantity || medication.qty || 'N/A'}`,
        `Instructions: ${medication.instructions || 'N/A'}`
      ]
    });

  });

  // Include current prescription if medication history is empty.
  if (
    patient.prescription &&
    patient.prescription !== 'None' &&
    !(patient.medications || []).length
  ) {

    journey.push({
      stage: 'Prescription',
      date: '',
      details: [
        patient.prescription
      ]
    });

  }

  // -------------------------------------------------------
  // 8. NURSING
  // -------------------------------------------------------

  (patient.nursingHistory || []).forEach(entry => {

    journey.push({
      stage: 'Nursing / Ward',
      date: entry.date || '',
      details: [
        `Bed: ${entry.bed || 'N/A'}`,
        `Procedure: ${entry.procedure || entry.proc || 'N/A'}`,
        `Medication: ${entry.medication || entry.medAdmin || 'N/A'}`,
        `Monitoring: ${entry.monitoring || 'N/A'}`,
        `Nursing Notes: ${entry.notes || 'N/A'}`
      ]
    });

  });

  // -------------------------------------------------------
  // 9. THEATRE
  // -------------------------------------------------------

  (patient.theatreHistory || []).forEach(entry => {

    journey.push({
      stage: 'Operating Theatre',
      date: entry.date || '',
      details: [
        `Procedure: ${entry.procedure || 'N/A'}`,
        `Surgeon: ${entry.surgeon || 'N/A'}`,
        `Anaesthetist: ${entry.anaesthetist || 'N/A'}`,
        `Anaesthesia: ${entry.anaesthesia || 'N/A'}`,
        `Notes: ${entry.notes || 'N/A'}`
      ]
    });

  });

  // -------------------------------------------------------
  // 10. REFERRALS
  // -------------------------------------------------------

  (patient.referrals || []).forEach(ref => {

    journey.push({
      stage: 'Referral',
      date: ref.date || '',
      details: [
        `Destination: ${ref.destination || ref.department || 'N/A'}`,
        `Notes: ${ref.note || 'N/A'}`,
        `Status: ${ref.status || 'N/A'}`,
        `Referred By: ${ref.referredBy || 'Doctor'}`
      ]
    });

  });

  // -------------------------------------------------------
  // 11. FOLLOW-UP
  // -------------------------------------------------------

  if (patient.followUp) {

    journey.push({
      stage: 'Follow-up',
      date: patient.followUp.date || '',
      details: [
        `Notes: ${patient.followUp.notes || 'N/A'}`,
        `Active: ${patient.followUp.active ? 'Yes' : 'No'}`
      ]
    });

  }

  // -------------------------------------------------------
  // 12. BILLING
  // -------------------------------------------------------

  (patient.paymentHistory || []).forEach(payment => {

    journey.push({
      stage: 'Billing / Finance',
      date: payment.date || '',
      details: [
        `Description: ${payment.description || 'Payment'}`,
        `Amount: ${money(payment.amount || 0)}`
      ]
    });

  });

  return journey.sort((a, b) => {

    const dateA =
      a.date
        ? new Date(a.date).getTime()
        : 0;

    const dateB =
      b.date
        ? new Date(b.date).getTime()
        : 0;

    return dateA - dateB;

  });

};

// =========================================================
// DASHBOARD AUTO REFRESH
// =========================================================

setInterval(
  function () {
    if (
      typeof refreshUI === 'function'
    ) {
      refreshUI();
    }
  },
  60000
);


// =========================================================
// HMS LOGOUT
// =========================================================

// =========================================================
// HMS LOGOUT
// SERVER-SIDE SESSION LOGOUT
// =========================================================

async function hmsLogout() {

    try {

        await fetch(
            '/api/auth/logout',
            {
                method: 'POST',
                credentials: 'same-origin'
            }
        );

    } catch (error) {

        console.error(
            'HMS logout request failed:',
            error
        );

    } finally {

        window.location.replace('/login');

    }
}

// ============================================================
// HOSPITAL SETUP
// DATABASE-BACKED
// NO ACTIVE / INACTIVE FUNCTIONALITY
// ACTIONS: EDIT + DELETE ONLY
// ============================================================

// ============================================================
// GENERIC JSON RESPONSE HELPER
// ============================================================

async function hospitalSetupResponse(response) {

    const text = await response.text();

    let data = {};

    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        throw new Error(
            `Server returned invalid JSON (${response.status}).`
        );
    }

    if (!response.ok) {

        throw new Error(
            data.error ||
            data.message ||
            `Server error (${response.status}).`
        );
    }

    return data;
}

// ============================================================
// DEPARTMENTS
// ============================================================

async function loadDepartments() {

    try {

        const response =
            await fetch('/api/departments/', {
                credentials: 'same-origin',
                cache: 'no-store'
            });

        const data =
            await hospitalSetupResponse(response);

        const departments =
            Array.isArray(data.departments)
                ? data.departments
                : [];

        state.config.departments =
            departments;

        renderDepartments();

    } catch (error) {

        console.error(
            'HMS: Failed to load departments:',
            error
        );

        state.config.departments = [];

        renderDepartments();

    }
}

// ============================================================
// RENDER DEPARTMENTS
// ============================================================

function renderDepartments() {

    const list =
        document.getElementById(
            'cfg-dept-list'
        );

    if (!list) return;

    const departments =
        Array.isArray(state.config.departments)
            ? state.config.departments
            : [];

    if (!departments.length) {

        list.innerHTML =
            '<li>No departments added.</li>';

        return;
    }

    list.innerHTML =
        departments.map(department => {

            const id =
                department.id;

            const name =
                department.name || '';

            return `
                <li
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        gap:10px;
                        margin-bottom:8px;
                    "
                >

                    <span>
                        ${escapeHTML(name)}
                    </span>

                    <span>

                        <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            onclick="
                                editDepartment(${id})
                            "
                        >
                            Edit
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger btn-sm"
                            onclick="
                                deleteDepartment(${id})
                            "
                        >
                            Delete
                        </button>

                    </span>

                </li>
            `;

        }).join('');
}

// ============================================================
// ADD DEPARTMENT
// ============================================================

async function addDepartment(event) {

    event.preventDefault();

    const input =
        document.getElementById(
            'cfg-dept-name'
        );

    if (!input) return;

    const name =
        input.value.trim();

    if (!name) {

        alert(
            'Enter a department or clinic name.'
        );

        return;
    }

    try {

        const response =
            await fetch(
                '/api/departments/',
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    credentials: 'same-origin',

                    body: JSON.stringify({
                        name: name
                    })
                }
            );

        const data =
            await hospitalSetupResponse(response);

        input.value = '';

        await loadDepartments();

        alert(
            data.message ||
            'Department created successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Create department failed:',
            error
        );

        alert(
            error.message ||
            'Unable to create department.'
        );
    }
}

// ============================================================
// EDIT DEPARTMENT
// ============================================================

async function editDepartment(id) {

    const department =
        state.config.departments.find(
            item => Number(item.id) === Number(id)
        );

    if (!department) return;

    const newName =
        prompt(
            'Edit department / clinic name:',
            department.name || ''
        );

    if (newName === null) return;

    const name =
        newName.trim();

    if (!name) {

        alert(
            'Department name cannot be empty.'
        );

        return;
    }

    try {

        const response =
            await fetch(
                `/api/departments/${id}`,
                {
                    method: 'PUT',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    credentials: 'same-origin',

                    body: JSON.stringify({
                        name: name
                    })
                }
            );

        const data =
            await hospitalSetupResponse(response);

        await loadDepartments();

        alert(
            data.message ||
            'Department updated successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Update department failed:',
            error
        );

        alert(
            error.message ||
            'Unable to update department.'
        );
    }
}

// ============================================================
// DELETE DEPARTMENT
// ============================================================

async function deleteDepartment(id) {

    const department =
        state.config.departments.find(
            item => Number(item.id) === Number(id)
        );

    if (!department) return;

    const confirmed =
        confirm(
            `Delete "${department.name}"?`
        );

    if (!confirmed) return;

    try {

        const response =
            await fetch(
                `/api/departments/${id}`,
                {
                    method: 'DELETE',

                    credentials: 'same-origin'
                }
            );

        const data =
            await hospitalSetupResponse(response);

        await loadDepartments();

        alert(
            data.message ||
            'Department deleted successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Delete department failed:',
            error
        );

        alert(
            error.message ||
            'Unable to delete department.'
        );
    }
}

// ============================================================
// WARDS
// ============================================================

async function loadWards() {

    try {

        const response =
            await fetch(
                '/api/wards/',
                {
                    credentials: 'same-origin',
                    cache: 'no-store'
                }
            );

        const data =
            await hospitalSetupResponse(response);

        const wards =
            Array.isArray(data.wards)
                ? data.wards
                : Array.isArray(data)
                    ? data
                    : [];

        state.config.wards =
            wards;

        renderWards();

    } catch (error) {

        console.error(
            'HMS: Failed to load wards:',
            error
        );

        state.config.wards = [];

        renderWards();
    }
}

// ============================================================
// RENDER WARDS
// ============================================================

function renderWards() {

    const list =
        document.getElementById(
            'cfg-ward-list'
        );

    if (!list) return;

    const wards =
        Array.isArray(state.config.wards)
            ? state.config.wards
            : [];

    if (!wards.length) {

        list.innerHTML =
            '<li>No wards configured.</li>';

        return;
    }

    list.innerHTML =
        wards.map(ward => {

            const id =
                ward.id;

            const name =
                ward.name || '';

            const capacity =
                Number(
                    ward.capacity || 0
                );

            return `
                <li
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        gap:10px;
                        margin-bottom:8px;
                    "
                >

                    <span>
                        ${escapeHTML(name)}
                        (${capacity} Beds)
                    </span>

                    <span>

                        <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            onclick="
                                editWard(${id})
                            "
                        >
                            Edit
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger btn-sm"
                            onclick="
                                deleteWard(${id})
                            "
                        >
                            Delete
                        </button>

                    </span>

                </li>
            `;

        }).join('');
}

// ============================================================
// ADD WARD
// ============================================================

async function addWard(event) {

    event.preventDefault();

    const nameInput =
        document.getElementById(
            'cfg-ward-name'
        );

    const capacityInput =
        document.getElementById(
            'cfg-ward-capacity'
        );

    if (!nameInput || !capacityInput) {
        return;
    }

    const name =
        nameInput.value.trim();

    const capacity =
        Number(
            capacityInput.value
        );

    if (!name) {

        alert(
            'Enter a ward name.'
        );

        return;
    }

    if (
        !Number.isInteger(capacity) ||
        capacity < 1
    ) {

        alert(
            'Enter a valid bed capacity.'
        );

        return;
    }

    try {

        const response =
            await fetch(
                '/api/wards/',
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    credentials: 'same-origin',

                    body: JSON.stringify({
                        name: name,
                        capacity: capacity
                    })
                }
            );

        const data =
            await hospitalSetupResponse(response);

        nameInput.value = '';
        capacityInput.value = '';

        await loadWards();

        alert(
            data.message ||
            'Ward created successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Create ward failed:',
            error
        );

        alert(
            error.message ||
            'Unable to create ward.'
        );
    }
}

// ============================================================
// EDIT WARD
// ============================================================

async function editWard(id) {

    const ward =
        state.config.wards.find(
            item => Number(item.id) === Number(id)
        );

    if (!ward) return;

    const newName =
        prompt(
            'Edit ward name:',
            ward.name || ''
        );

    if (newName === null) return;

    const name =
        newName.trim();

    if (!name) {

        alert(
            'Ward name cannot be empty.'
        );

        return;
    }

    const newCapacity =
        prompt(
            'Edit bed capacity:',
            ward.capacity || 0
        );

    if (newCapacity === null) return;

    const capacity =
        Number(newCapacity);

    if (
        !Number.isInteger(capacity) ||
        capacity < 1
    ) {

        alert(
            'Enter a valid bed capacity.'
        );

        return;
    }

    try {

        const response =
            await fetch(
                `/api/wards/${id}`,
                {
                    method: 'PUT',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    credentials: 'same-origin',

                    body: JSON.stringify({
                        name: name,
                        capacity: capacity
                    })
                }
            );

        const data =
            await hospitalSetupResponse(response);

        await loadWards();

        alert(
            data.message ||
            'Ward updated successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Update ward failed:',
            error
        );

        alert(
            error.message ||
            'Unable to update ward.'
        );
    }
}

// ============================================================
// DELETE WARD
// ============================================================

async function deleteWard(id) {

    const ward =
        state.config.wards.find(
            item => Number(item.id) === Number(id)
        );

    if (!ward) return;

    const confirmed =
        confirm(
            `Delete "${ward.name}"?`
        );

    if (!confirmed) return;

    try {

        const response =
            await fetch(
                `/api/wards/${id}`,
                {
                    method: 'DELETE',

                    credentials: 'same-origin'
                }
            );

        const data =
            await hospitalSetupResponse(response);

        await loadWards();

        alert(
            data.message ||
            'Ward deleted successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Delete ward failed:',
            error
        );

        alert(
            error.message ||
            'Unable to delete ward.'
        );
    }
}

// ============================================================
// SERVICES
// ============================================================

async function loadServices() {

    try {

        const response =
            await fetch(
                '/api/services/',
                {
                    credentials: 'same-origin',
                    cache: 'no-store'
                }
            );

        const data =
            await hospitalSetupResponse(response);

        const services =
            Array.isArray(data.services)
                ? data.services
                : Array.isArray(data)
                    ? data
                    : [];

        state.config.services =
            services;

        renderServices();

    } catch (error) {

        console.error(
            'HMS: Failed to load services:',
            error
        );

        state.config.services = [];

        renderServices();
    }
}

// ============================================================
// RENDER SERVICES
// ============================================================

function renderServices() {

    const list =
        document.getElementById(
            'cfg-service-list'
        );

    if (!list) return;

    const services =
        Array.isArray(state.config.services)
            ? state.config.services
            : [];

    if (!services.length) {

        list.innerHTML =
            '<li>No services configured.</li>';

        return;
    }

    list.innerHTML =
        services.map(service => {

            const id =
                service.id;

            const name =
                service.name || '';

            const fee =
                Number(
                    service.fee || 0
                );

            return `
                <li
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        gap:10px;
                        margin-bottom:8px;
                    "
                >

                    <span>
                        ${escapeHTML(name)}
                        :
                        ${money(fee)}
                    </span>

                    <span>

                        <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            onclick="
                                editService(${id})
                            "
                        >
                            Edit
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger btn-sm"
                            onclick="
                                deleteService(${id})
                            "
                        >
                            Delete
                        </button>

                    </span>

                </li>
            `;

        }).join('');
}

// ============================================================
// ADD SERVICE
// ============================================================

function updateServiceTariffFields() {
    const category = document.getElementById('cfg-service-category')?.value || '';
    const group = document.getElementById('cfg-service-detail-group');
    const detail = document.getElementById('cfg-service-detail');
    const label = document.getElementById('cfg-service-detail-label');
    const help = document.getElementById('cfg-service-detail-help');
    if (!group || !detail || !label) return;

    const details = {
        lab: { label: 'Sample type / lab test', placeholder: 'e.g. Blood, urine, stool, sputum', help: 'Add each sample/test type separately so it can have its own fee.' },
        imaging: { label: 'Imaging type', placeholder: 'e.g. Chest X-ray, ultrasound, CT scan', help: 'Add each imaging type separately so it can have its own fee.' },
        surgery: { label: 'Surgery type', placeholder: 'e.g. Appendectomy, caesarean section', help: 'Add each surgery type separately so it can have its own fee.' }
    };
    const config = details[category];
    group.style.display = config ? '' : 'none';
    detail.required = Boolean(config);
    if (config) {
        label.textContent = config.label;
        detail.placeholder = config.placeholder;
        if (help) help.textContent = config.help;
    } else {
        detail.value = '';
        detail.required = false;
    }
}

async function addService(event) {
    event.preventDefault();

    const categoryInput = document.getElementById('cfg-service-category');
    const detailInput = document.getElementById('cfg-service-detail');
    const feeInput = document.getElementById('cfg-service-fee');
    if (!categoryInput || !detailInput || !feeInput) return;

    const category = categoryInput.value;
    const detail = detailInput.value.trim();
    const fee = Number(feeInput.value);
    const categories = {
        registration: 'Per patient registration',
        triage: 'Per triage assessment',
        consultation: 'Per doctor consultation',
        lab: 'Per lab test',
        imaging: 'Per radio imaging',
        surgery: 'Per surgery',
        nursing_day: 'Per nursing day from admission',
        guidance: 'Per guidance counseling session'
    };
    if (!categories[category]) {
        alert('Select a tariff category.');
        return;
    }
    if (['lab', 'imaging', 'surgery'].includes(category) && !detail) {
        alert('Enter the specific type for this tariff.');
        detailInput.focus();
        return;
    }
    if (!Number.isFinite(fee) || fee < 0 || feeInput.value === '') {
        alert('Enter a valid fee of zero or more.');
        return;
    }

    const name = ['lab', 'imaging', 'surgery'].includes(category)
        ? `${categories[category]} — ${detail}`
        : categories[category];

    try {
        const response = await fetch('/api/services/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name, fee })
        });
        const data = await hospitalSetupResponse(response);
        categoryInput.value = '';
        detailInput.value = '';
        feeInput.value = '';
        updateServiceTariffFields();
        await loadServices();
        alert(data.message || 'Tariff created successfully.');
    } catch (error) {
        console.error('HMS: Create tariff failed:', error);
        alert(error.message || 'Unable to create tariff.');
    }
}

// ============================================================
// EDIT SERVICE
// ============================================================

async function editService(id) {

    const service =
        state.config.services.find(
            item => Number(item.id) === Number(id)
        );

    if (!service) return;

    const newName =
        prompt(
            'Edit service name:',
            service.name || ''
        );

    if (newName === null) return;

    const name =
        newName.trim();

    if (!name) {

        alert(
            'Service name cannot be empty.'
        );

        return;
    }

    const newFee =
        prompt(
            'Edit service fee:',
            service.fee || 0
        );

    if (newFee === null) return;

    const fee =
        Number(newFee);

    if (
        !Number.isFinite(fee) ||
        fee < 0
    ) {

        alert(
            'Enter a valid service fee.'
        );

        return;
    }

    try {

        const response =
            await fetch(
                `/api/services/${id}`,
                {
                    method: 'PUT',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    credentials: 'same-origin',

                    body: JSON.stringify({
                        name: name,
                        fee: fee
                    })
                }
            );

        const data =
            await hospitalSetupResponse(response);

        await loadServices();

        alert(
            data.message ||
            'Service updated successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Update service failed:',
            error
        );

        alert(
            error.message ||
            'Unable to update service.'
        );
    }
}

// ============================================================
// DELETE SERVICE
// ============================================================

async function deleteService(id) {

    const service =
        state.config.services.find(
            item => Number(item.id) === Number(id)
        );

    if (!service) return;

    const confirmed =
        confirm(
            `Delete "${service.name}"?`
        );

    if (!confirmed) return;

    try {

        const response =
            await fetch(
                `/api/services/${id}`,
                {
                    method: 'DELETE',

                    credentials: 'same-origin'
                }
            );

        const data =
            await hospitalSetupResponse(response);

        await loadServices();

        alert(
            data.message ||
            'Service deleted successfully.'
        );

    } catch (error) {

        console.error(
            'HMS: Delete service failed:',
            error
        );

        alert(
            error.message ||
            'Unable to delete service.'
        );
    }
}

// ============================================================
// INITIAL LOAD
// ============================================================

async function loadHospitalSetup() {

    await Promise.allSettled([
        loadDepartments(),
        loadWards(),
        loadServices()
    ]);

}

// =========================================================
// DOCTOR RADIOLOGY IMAGE CONTROLS
// =========================================================

function getDoctorRadiologyImageFromButton(button) {

    if (
        !button ||
        !button.parentElement
    ) {

        console.error(
            'Radiology image control: button not found.'
        );

        return null;
    }

    const resultCard =
        button.parentElement.closest(
            '.doctor-radiology-result'
        );

    if (!resultCard) {

        console.error(
            'Radiology image control: result card not found.'
        );

        return null;
    }

    const image =
        resultCard.querySelector(
            '.doctor-radiology-image'
        );

    if (!image) {

        console.error(
            'Radiology image control: image not found.'
        );

        return null;
    }

    return image;
}

// =========================================================
// ZOOM
// =========================================================

function zoomDoctorRadiologyImage(
    button,
    amount
) {

    const image =
        getDoctorRadiologyImageFromButton(
            button
        );

    if (!image) {
        return;
    }

    let zoom =
        parseFloat(
            image.dataset.zoom || '1'
        );

    zoom += Number(amount);

    zoom =
        Math.max(
            0.5,
            Math.min(
                zoom,
                4
            )
        );

    image.dataset.zoom =
        String(zoom);

    image.style.transform =
        `scale(${zoom})`;

    image.style.transformOrigin =
        'center center';
}

// =========================================================
// FIT / RESET
// =========================================================

function resetDoctorRadiologyImage(
    button
) {

    const image =
        getDoctorRadiologyImageFromButton(
            button
        );

    if (!image) {
        return;
    }

    image.dataset.zoom =
        '1';

    image.style.transform =
        'scale(1)';

    image.style.transformOrigin =
        'center center';
}

// =========================================================
// FULL SCREEN
// =========================================================

function fullscreenDoctorRadiologyImage(
    button
) {

    const image =
        getDoctorRadiologyImageFromButton(
            button
        );

    if (!image) {
        return;
    }

    if (
        document.fullscreenElement
    ) {

        document.exitFullscreen()
            .catch(function () {});

        return;
    }

    // -----------------------------------------------------
    // Native fullscreen on the IMAGE itself
    // -----------------------------------------------------

    if (
        image.requestFullscreen
    ) {

        image.requestFullscreen()
            .catch(function () {

                openDoctorRadiologyFullscreenFallback(
                    image
                );

            });

        return;
    }

    // -----------------------------------------------------
    // WebKit fallback
    // -----------------------------------------------------

    if (
        image.webkitRequestFullscreen
    ) {

        image.webkitRequestFullscreen();

        return;
    }

    // -----------------------------------------------------
    // Custom fallback
    // -----------------------------------------------------

    openDoctorRadiologyFullscreenFallback(
        image
    );
}

// =========================================================
// CUSTOM FULLSCREEN FALLBACK
// =========================================================

function openDoctorRadiologyFullscreenFallback(
    image
) {

    const existing =
        document.getElementById(
            'doctor-radiology-fullscreen-fallback'
        );

    if (existing) {
        existing.remove();
    }

    const overlay =
        document.createElement(
            'div'
        );

    overlay.id =
        'doctor-radiology-fullscreen-fallback';

    overlay.style.position =
        'fixed';

    overlay.style.inset =
        '0';

    overlay.style.width =
        '100vw';

    overlay.style.height =
        '100vh';

    overlay.style.background =
        '#000';

    overlay.style.zIndex =
        '999999';

    overlay.style.display =
        'flex';

    overlay.style.alignItems =
        'center';

    overlay.style.justifyContent =
        'center';

    overlay.style.overflow =
        'auto';

    const fullscreenImage =
        document.createElement(
            'img'
        );

    fullscreenImage.src =
        image.currentSrc ||
        image.src;

    fullscreenImage.alt =
        image.alt ||
        'Radiology scan';

    fullscreenImage.style.maxWidth =
        '95vw';

    fullscreenImage.style.maxHeight =
        '95vh';

    fullscreenImage.style.width =
        'auto';

    fullscreenImage.style.height =
        'auto';

    fullscreenImage.style.objectFit =
        'contain';

    const closeButton =
        document.createElement(
            'button'
        );

    closeButton.type =
        'button';

    closeButton.textContent =
        '✕';

    closeButton.style.position =
        'fixed';

    closeButton.style.top =
        '15px';

    closeButton.style.right =
        '15px';

    closeButton.style.zIndex =
        '1000000';

    closeButton.style.fontSize =
        '24px';

    closeButton.style.padding =
        '8px 14px';

    closeButton.style.cursor =
        'pointer';

    function closeFallback() {

        overlay.remove();

        document.removeEventListener(
            'keydown',
            escapeHandler
        );

    }

    function escapeHandler(event) {

        if (
            event.key === 'Escape'
        ) {

            closeFallback();

        }

    }

    closeButton.onclick =
        closeFallback;

    document.addEventListener(
        'keydown',
        escapeHandler
    );

    overlay.appendChild(
        fullscreenImage
    );

    overlay.appendChild(
        closeButton
    );

    document.body.appendChild(
        overlay
    );
}

// =========================================================
// OPD PATIENT CLINICAL RECORD
// COMPLETE PATIENT JOURNEY
// =========================================================

function loadOPDPatientRecord() {

  const select =
    document.getElementById(
      'opd-patient-select'
    );

  const summary =
    document.getElementById(
      'opd-patient-summary'
    );

  const journeyContainer =
    document.getElementById(
      'opd-patient-journey-content'
    );

  const historyTable =
    document.getElementById(
      'opd-patient-history-table'
    );

  if (
    !select ||
    !summary ||
    !journeyContainer ||
    !historyTable
  ) {
    return;
  }

  const patientId =
    String(
      select.value || ''
    );

  if (!patientId) {

    summary.innerHTML = `
      <strong>Patient Summary:</strong>
      <span>
        Select a patient to view the complete patient journey.
      </span>
    `;

    journeyContainer.innerHTML = `
      <em>
        Select a patient to display all recorded stages.
      </em>
    `;

    historyTable.innerHTML = '';

    return;
  }

  const patient =
    state.patients.find(
      item =>
        String(
          item.id ||
          item.patient_id ||
          item.databaseId ||
          ''
        ) === patientId
    );

  if (!patient) {

    summary.innerHTML = `
      <strong>Patient Summary:</strong>
      <span>
        Patient record could not be found.
      </span>
    `;

    journeyContainer.innerHTML =
      '<em>Patient record not found.</em>';

    historyTable.innerHTML = '';

    return;
  }

  // =======================================================
  // PATIENT SUMMARY
  // =======================================================

  summary.innerHTML = `
    <strong>Patient Summary:</strong>

    <div style="
      display:grid;
      grid-template-columns:
        repeat(auto-fit,minmax(180px,1fr));
      gap:12px;
      margin-top:10px;
    ">

      <div>
        <strong>Patient ID</strong>
        <span>
          ${escapeHTML(
            patient.patient_id ||
            patient.id ||
            'N/A'
          )}
        </span>
      </div>

      <div>
        <strong>Patient Name</strong>
        <span>
          ${escapeHTML(
            patient.full_name ||
            patient.name ||
            'N/A'
          )}
        </span>
      </div>

      <div>
        <strong>Date of Birth</strong>
        <span>
          ${escapeHTML(
            patient.date_of_birth ||
            patient.dob ||
            'N/A'
          )}
        </span>
      </div>

      <div>
        <strong>Gender</strong>
        <span>
          ${escapeHTML(
            patient.gender ||
            'N/A'
          )}
        </span>
      </div>

      <div>
        <strong>Phone</strong>
        <span>
          ${escapeHTML(
            patient.phone ||
            'N/A'
          )}
        </span>
      </div>

      <div>
        <strong>Current Phase</strong>
        <span>
          ${escapeHTML(
            patient.phase ||
            'N/A'
          )}
        </span>
      </div>

    </div>
  `;

  // =======================================================
  // BUILD COMPLETE JOURNEY
  // =======================================================

  const journey =
    typeof window.buildCompletePatientJourney ===
    'function'
      ? window.buildCompletePatientJourney(patient)
      : [];

  if (!journey.length) {

    journeyContainer.innerHTML = `
      <em>
        No clinical operations have been recorded
        for this patient.
      </em>
    `;

    historyTable.innerHTML = '';

    return;
  }

  // =======================================================
  // COMPLETE JOURNEY DISPLAY
  // =======================================================

  journeyContainer.innerHTML =
    journey
      .map(
        (entry, index) => {

          const details =
            Array.isArray(entry.details)
              ? entry.details
              : [entry.details];

          return `
            <div
              class="hms-patient-journey-entry"
              style="
                border:1px solid #dbe2ea;
                border-radius:6px;
                padding:15px;
                margin-bottom:12px;
                background:#fff;
              "
            >

              <div style="
                display:flex;
                justify-content:space-between;
                gap:15px;
                flex-wrap:wrap;
                margin-bottom:10px;
              ">

                <strong>
                  ${index + 1}.
                  ${escapeHTML(
                    entry.stage ||
                    'Clinical Event'
                  )}
                </strong>

                <span>
                  ${escapeHTML(
                    entry.date
                      ? new Date(
                          entry.date
                        ).toLocaleString()
                      : 'Date not recorded'
                  )}
                </span>

              </div>

              <div>
                ${details
                  .filter(
                    detail =>
                      detail !== undefined &&
                      detail !== null &&
                      String(detail).trim() !== ''
                  )
                  .map(
                    detail => `
                      <div style="
                        padding:5px 0;
                        border-bottom:1px solid #f1f5f9;
                      ">
                        ${escapeHTML(
                          String(detail)
                        )}
                      </div>
                    `
                  )
                  .join('')}
              </div>

            </div>
          `;
        }
      )
      .join('');

  // =======================================================
  // CLINICAL HISTORY TABLE
  // =======================================================

  historyTable.innerHTML =
    journey
      .map(
        entry => {

          const details =
            Array.isArray(entry.details)
              ? entry.details.join(' | ')
              : String(
                  entry.details ||
                  ''
                );

          return `
            <tr>

              <td>
                ${escapeHTML(
                  entry.date
                    ? new Date(
                        entry.date
                      ).toLocaleString()
                    : 'N/A'
                )}
              </td>

              <td>
                ${escapeHTML(
                  entry.stage ||
                  'N/A'
                )}
              </td>

              <td>
                ${escapeHTML(
                  entry.staff ||
                  entry.performedBy ||
                  '—'
                )}
              </td>

              <td>
                ${escapeHTML(
                  details ||
                  'No clinical information recorded.'
                )}
              </td>

              <td>
                ${escapeHTML(
                  entry.status ||
                  'Recorded'
                )}
              </td>

            </tr>
          `;
        }
      )
      .join('');

}
// =========================================================
// EXPOSE FUNCTIONS GLOBALLY
// =========================================================

window.zoomDoctorRadiologyImage =
    zoomDoctorRadiologyImage;

window.resetDoctorRadiologyImage =
    resetDoctorRadiologyImage;

window.fullscreenDoctorRadiologyImage =
    fullscreenDoctorRadiologyImage;

// =========================================================
// EXPOSE USER MANAGEMENT FUNCTIONS
// =========================================================

window.deleteSystemUser = deleteSystemUser;
window.toggleSystemUserStatus = toggleSystemUserStatus;
window.loadSystemUsers = loadSystemUsers;
window.registerStaff =
    registerStaff;

window.handleStaffRoleChange =
      function () {};

window.loadStaffFromDatabase =
    loadStaffFromDatabase;



window.editStaff =
    editStaff;

window.deleteStaff =
    deleteStaff;

// ============================================================
// SEARCHABLE PATIENT SELECTS — SEARCH IN THE SAME SELECT BAR
// Preserves the original select element/value for existing HMS code.
// ============================================================
(function installHmsSearchableSelects() {
    'use strict';
    const WRAP = 'data-hms-search-wrap';
    const IDS = new Set([
        'admin-pt-select','admin-patient-select','triage-patient-select',
        'doc-patient-select','pharm-patient-select','nurse-patient-select',
        'ot-patient-select','opd-patient-select','acc-patient-select',
        'lab-patient-select','radiology-patient-select','medical-report-patient-select'
    ]);
    const isPatient = s => s instanceof HTMLSelectElement && !s.multiple &&
        (IDS.has(s.id) || /patient|client/i.test((s.id||'')+' '+(s.labels ? [...s.labels].map(l=>l.textContent).join(' ') : '')));

    function install(select) {
        if (!isPatient(select) || select.hasAttribute(WRAP) || !select.parentNode) return;
        select.setAttribute(WRAP, '1');
        const wrapper = document.createElement('div');
        wrapper.className = 'hms-patient-search-control';
        wrapper.style.cssText = 'position:relative;width:100%;min-width:0;';
        const input = document.createElement('input');
        input.type = 'text'; input.autocomplete = 'off';
        input.placeholder = 'Select or type to search patients...';
        input.setAttribute('aria-label','Search and select patient');
        input.className = select.className || '';
        input.style.cssText = 'width:100%;min-height:38px;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:inherit;font:inherit;';
        const menu = document.createElement('div');
        menu.className = 'hms-patient-search-options';
        menu.style.cssText = 'display:none;position:absolute;left:0;right:0;top:100%;max-height:260px;overflow:auto;background:#fff;color:#111827;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.15);z-index:99999;';
        const parent = select.parentNode;
        parent.insertBefore(wrapper, select);
        wrapper.append(input, menu);
        // Keep the original select in the DOM so all existing code and form submits work.
        select.style.position = 'absolute'; select.style.width = '1px'; select.style.height = '1px';
        select.style.opacity = '0'; select.style.pointerEvents = 'none'; select.style.left = '-10000px';
        wrapper.appendChild(select);

        function render(query, showAll) {
            const q = (query || '').trim().toLocaleLowerCase();
            menu.replaceChildren();
            const options = Array.from(select.options).filter(o => {
                if (!o.value) return true;
                const text = (o.textContent || '').toLocaleLowerCase();
                return showAll || !q || text.includes(q) || String(o.value).toLocaleLowerCase().includes(q);
            }).filter(o => {
                if (!o.value) return true;
                const t = (o.textContent || '').toUpperCase();
                return !(t.includes('[MERGED]') || t.includes('(MERGED)') || t.includes('— MERGED'));
            });
            options.slice(0,200).forEach(option => {
                const row = document.createElement('div');
                row.textContent = option.textContent || '';
                row.setAttribute('role','option');
                row.style.cssText = 'padding:9px 10px;cursor:pointer;white-space:normal;';
                if (option.value === select.value) row.style.background = '#e5eefb';
                row.addEventListener('mouseenter',()=>row.style.background='#eef2ff');
                row.addEventListener('mouseleave',()=>row.style.background=option.value===select.value?'#e5eefb':'#fff');
                row.addEventListener('mousedown', e => e.preventDefault());
                row.addEventListener('click', () => {
                    select.value = option.value;
                    input.value = option.value ? (option.textContent || '').trim() : '';
                    menu.style.display = 'none';
                    select.dispatchEvent(new Event('change',{bubbles:true}));
                });
                menu.appendChild(row);
            });
            if (!menu.children.length) {
                const empty = document.createElement('div'); empty.textContent = 'No matching patients';
                empty.style.cssText='padding:9px 10px;color:#64748b;'; menu.appendChild(empty);
            }
        }
        input.addEventListener('focus',()=>{render(input.value,true);menu.style.display='block';});
        // IMPORTANT: do not dispatch a select change while the user is typing.
        // The select's own change handler copies its selected option back into
        // the input, which previously erased every character as it was entered.
        input.addEventListener('input',()=>{
            select.value = '';
            render(input.value, false);
            menu.style.display = 'block';
        });
        input.addEventListener('keydown',e=>{
            if(e.key==='Escape'){menu.style.display='none';return;}
            if(e.key==='ArrowDown'){e.preventDefault();const first=menu.querySelector('[role="option"]');if(first)first.click();}
            if(e.key==='Enter'){const first=menu.querySelector('[role="option"]');if(first){e.preventDefault();first.click();}}
        });
        document.addEventListener('click',e=>{if(!wrapper.contains(e.target))menu.style.display='none';});
        select.addEventListener('change',()=>{const o=select.options[select.selectedIndex];input.value=o&&o.value?(o.textContent||'').trim():'';});
        const observer = new MutationObserver(()=>{
            const o=select.options[select.selectedIndex];
            if(o&&o.value&&!input.matches(':focus')) input.value=(o.textContent||'').trim();
            if(menu.style.display==='block') render(input.value, !input.value.trim());
        });
        observer.observe(select,{childList:true,subtree:true,characterData:true});
        const selected=select.options[select.selectedIndex]; if(selected&&selected.value)input.value=(selected.textContent||'').trim();
    }
    function scan(root){ if(!root||!root.querySelectorAll)return; if(root instanceof HTMLSelectElement)install(root); root.querySelectorAll('select').forEach(install); }
    function start(){scan(document);new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(n=>{if(n.nodeType===1)scan(n);}))).observe(document.body||document.documentElement,{childList:true,subtree:true});}
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();


// ============================================================================
// SECRETARIATE, PROCUREMENT, AND GUIDANCE & COUNSELING
// Database-backed workspaces. Uses /api/office/* routes.
// Keeps existing module-view containers and creates Guidance & Counseling
// dynamically when it is not present in hms.html.
// ============================================================================
(function installOfficeAndCounselingModules() {
  'use strict';

  const API = '/api/office';

  // Match the Flask blueprint prefixes in secretariate_routes.py,
  // procurement_routes.py, and guidance_counseling_routes.py.
  function officePath(moduleId, path) {
    const prefix = moduleId === 'secretariate'
      ? '/secretariate'
      : moduleId === 'procurement'
        ? '/procurement'
        : moduleId === 'guidance-counseling'
          ? '/guidance'
          : '';
    return API + prefix + (path.startsWith('/') ? path : '/' + path);
  }
  const MODULES = [
    {id:'procurement', name:'Procurement', icon:'📦'},
    {id:'guidance-counseling', name:'Guidance & Counseling', icon:'🧭'}
  ];
  const TEMPLATE_TYPES = [
    'Statement','Letter','Memo','Circular','Report','Speech','Minutes',
    'Evaluation','Interview','Questionnaire','Manual','Directions',
    'Campaign Message','Warning Notice','Business Document','Requisition'
  ];
  const COUNSELING_TYPES = [
    'Intake','Counseling Session','Follow-up','Guidance','Referral','Resource'
  ];
  // Search by ID in either the document or a nested element. Element nodes
  // do not implement getElementById(), so use querySelector() for nested roots.
  const $ = (id, root = document) => {
    if (root === document) return document.getElementById(id);
    return root && typeof root.querySelector === 'function'
      ? root.querySelector('[id="' + String(id).replace(/"/g, '\\"') + '"]')
      : null;
  };
  const esc = value => typeof escapeHTML === 'function'
    ? escapeHTML(value == null ? '' : String(value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
      }[c]));
  const text = value => String(value == null ? '' : value);

  function ensureModuleView(id, name) {
    let view = $('mod-' + id);
    if (!view) {
      view = document.createElement('section');
      view.id = 'mod-' + id;
      view.className = 'module-view';
      view.hidden = true;
      const area = document.querySelector('.content-area') || $('main') || document.body;
      area.appendChild(view);
    }
    if (!view.classList.contains('module-view')) view.classList.add('module-view');
    view.dataset.hmsOfficeModule = id;
    return view;
  }

  function ensureModuleEntries() {
    if (typeof state === 'undefined' || !Array.isArray(state.modules)) return;
    MODULES.forEach(item => {
      if (!state.modules.some(m => m.id === item.id)) state.modules.push(item);
    });
  }

  // The database workspace was deliberately removed from the HMS UI.
  // Keep this compatibility function only so older initialization calls do
  // not inject a second workspace or duplicate tabs into existing modules.
  function ensureWorkspace(id, name) {
    return ensureModuleView(id, name);
  }

  function activeTab(id) {
    const shell = $(id + '-api-workspace');
    return shell?.querySelector('[data-office-tab].btn-primary')?.dataset.officeTab ||
      shell?.querySelector('[data-office-tab]')?.dataset.officeTab || 'overview';
  }
  function status(id, message, bad=false) {
    const el = $(id + '-api-workspace')?.querySelector('[data-office-status]');
    if (el) { el.textContent = message || ''; el.style.color = bad ? '#b91c1c' : '#475569'; }
  }
  function setContent(id, html) {
    const el = $(id + '-api-workspace')?.querySelector('[data-office-content]');
    if (el) el.innerHTML = html;
  }
  function field(label, name, type='text', required=false, extra='') {
    return `<label style="display:flex;flex-direction:column;gap:5px;min-width:0"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(type)}" ${required?'required':''} ${extra} style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:6px"></label>`;
  }
  function area(label, name, required=false) {
    return `<label style="display:flex;flex-direction:column;gap:5px;min-width:0"><span>${esc(label)}</span><textarea name="${esc(name)}" ${required?'required':''} rows="4" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:6px"></textarea></label>`;
  }
  function selectField(label,name,options,required=false) {
    return `<label style="display:flex;flex-direction:column;gap:5px;min-width:0"><span>${esc(label)}</span><select name="${esc(name)}" ${required?'required':''} style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:6px"><option value="">Select ${esc(label)}</option>${options.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>`;
  }
  function form(id, action, body, button='Save') {
    return `<form data-office-form="${esc(action)}" data-office-module="${esc(id)}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px;margin-bottom:18px;padding:14px;border:1px solid #e2e8f0;border-radius:9px"><div style="grid-column:1/-1"><strong>${esc(button)}</strong></div>${body}<div style="grid-column:1/-1"><button class="btn btn-primary" type="submit" style="padding:9px 14px;border:0;border-radius:6px;cursor:pointer">${esc(button)}</button></div></form>`;
  }
  function table(headers, rows) {
    return `<div style="overflow:auto;max-width:100%"><table style="border-collapse:collapse;width:100%;min-width:600px"><thead><tr>${headers.map(h=>`<th style="text-align:left;padding:9px;background:#f1f5f9;border-bottom:1px solid #cbd5e1">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function row(cells) {
    return `<tr>${cells.map(c=>`<td style="padding:9px;border-bottom:1px solid #e2e8f0;vertical-align:top">${c}</td>`).join('')}</tr>`;
  }
  async function request(path, options={}) {
    const response = await fetch(path, {
      credentials:'same-origin', cache:'no-store',
      ...options,
      headers: options.body instanceof FormData ? (options.headers || {}) : {
        'Content-Type':'application/json','Accept':'application/json',...(options.headers||{})
      }
    });
    const data = await response.json().catch(()=>({success:false,error:'Server returned an invalid response.'}));
    if (!response.ok || data.success === false) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    return data;
  }
  function docFilters() {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px;margin-bottom:12px">
      <input data-doc-search placeholder="Search documents" aria-label="Search documents" style="padding:9px;border:1px solid #cbd5e1;border-radius:6px">
      <select data-doc-type aria-label="Document type" style="padding:9px;border:1px solid #cbd5e1;border-radius:6px"><option value="">All types</option>${TEMPLATE_TYPES.map(t=>`<option>${esc(t)}</option>`).join('')}<option>Scanned Document</option><option>Purchase Document</option></select>
      <input data-doc-from type="date" aria-label="From date" style="padding:9px;border:1px solid #cbd5e1;border-radius:6px">
      <input data-doc-to type="date" aria-label="To date" style="padding:9px;border:1px solid #cbd5e1;border-radius:6px">
    </div>`;
  }
  async function loadTab(id, tab) {
    if (!$ (id + '-api-workspace')) return;
    status(id,'Loading…');
    try {
      if (tab === 'templates' || tab === 'business-templates') {
        const data = await request(officePath(id, '/templates'));
        const types = id === 'procurement' ? ['Business Document',...TEMPLATE_TYPES] : TEMPLATE_TYPES;
        setContent(id, form(id,'template-create',
          field('Template title','title','text',true) +
          selectField('Template type','template_type',types,true) +
          area('Template content','content',true), 'Create Template') +
          table(['Title','Type','Updated','Actions'], data.templates.map(t=>row([
            esc(t.title),esc(t.template_type),esc(t.updated_at || t.created_at || ''),
            `<button type="button" data-office-view-template="${t.id}">View / Print</button>
             <button type="button" data-office-delete-template="${t.id}">Delete</button>`
          ])).join('') || row(['No templates saved yet.','','',''])));
      } else if (tab === 'documents') {
        const data = await request(officePath(id, '/documents'));
        setContent(id, docFilters() + table(['Document','Type','Date','File / Content','Actions'],
          data.documents.map(d=>row([
            esc(d.title),esc(d.document_type),esc(d.document_date || d.created_at || ''),
            d.file_url ? `<a href="${esc(d.file_url)}" target="_blank" rel="noopener">Open file</a>` : esc((d.content||'').slice(0,160)),
            `<button type="button" data-office-view-doc="${d.id}">View / Print</button>
             <button type="button" data-office-delete-doc="${d.id}">Delete</button>`
          ])).join('') || row(['No documents saved yet.','','','',''])));
        const shell = $(id+'-api-workspace');
        const apply = () => {
          const q=(shell.querySelector('[data-doc-search]')?.value||'').toLowerCase();
          const type=shell.querySelector('[data-doc-type]')?.value||'';
          const from=shell.querySelector('[data-doc-from]')?.value||'';
          const to=shell.querySelector('[data-doc-to]')?.value||'';
          shell.querySelectorAll('tbody tr').forEach(tr=>{
            const content=tr.textContent.toLowerCase();
            const date=tr.cells[2]?.textContent.slice(0,10)||'';
            tr.hidden=!!((q&&!content.includes(q))||(type&&!tr.cells[1]?.textContent.includes(type))||(from&&date<from)||(to&&date>to));
          });
        };
        shell.querySelectorAll('[data-doc-search],[data-doc-type],[data-doc-from],[data-doc-to]').forEach(el=>el.addEventListener('input',apply));
      } else if (tab === 'scanner') {
        setContent(id, form(id,'document-upload',
          field('Choose scanned document','file','file',true,'accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx"') +
          field('Document title','title','text',true) +
          selectField('Document type','document_type',['Scanned Document','Invoice','Quotation','Purchase Order','Delivery Note','Receipt','Contract','Other'],true) +
          area('Notes','content'), 'Upload Document') +
          `<p style="color:#64748b">Uploaded documents are saved in the database record and secure upload folder.</p>`);
      } else if (tab === 'overview' || tab === 'summary') {
        const data = await request(officePath(id, '/counseling?view=summary'));
        const c = data.summary || {};
        setContent(id, `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
          ${[['Total records',c.total||0],['Intakes',c.intakes||0],['Sessions',c.sessions||0],['Follow-ups',c.followups||0],['Referrals',c.referrals||0]].map(([k,v])=>`<div style="padding:16px;border:1px solid #e2e8f0;border-radius:9px"><div style="color:#64748b">${esc(k)}</div><strong style="font-size:1.5rem">${esc(v)}</strong></div>`).join('')}
        </div><p style="margin-top:14px;color:#64748b">Counseling information is confidential and available only to authorized module roles.</p>`);
      } else {
        const data = await request(officePath(id, '/counseling?kind=' + encodeURIComponent(tab)));
        const kind = tab === 'intake' ? 'Intake' : tab === 'sessions' ? 'Counseling Session' : tab === 'follow-up' ? 'Follow-up' : tab === 'resources' ? 'Resource' : 'Guidance';
        const fields = field('Client / case reference','client_reference','text',true) +
          field('Client name or coded identifier','client_name','text',true) +
          selectField('Record type','record_type',COUNSELING_TYPES,true) +
          field('Date','record_date','date',true) +
          field('Follow-up date (optional)','follow_up_date','date') +
          field('Referral destination (optional)','referral_destination') +
          area('Notes / session record','notes',true) +
          area('Plan / outcome','outcome');
        setContent(id, form(id,'counseling-create',fields,'Save Record') +
          table(['Date','Client / Case','Type','Follow-up','Referral','Summary','Actions'],
          data.records.map(r=>row([
            esc(r.record_date||''),esc((r.client_name||'')+' ('+(r.client_reference||'')+')'),
            esc(r.record_type),esc(r.follow_up_date||''),esc(r.referral_destination||''),
            esc((r.notes||'').slice(0,130)),
            `<button type="button" data-office-view-counseling="${r.id}">View</button>
             <button type="button" data-office-delete-counseling="${r.id}">Delete</button>`
          ])).join('') || row(['No records saved yet.','','','','','',''])));
        const select = $(id+'-api-workspace')?.querySelector('[name="record_type"]');
        if (select) select.value = kind;
      }
      status(id,'');
    } catch (error) {
      console.error('HMS office module load error:', id, tab, error);
      status(id,error.message || 'Unable to load data.',true);
      if (!$(id+'-api-workspace')?.querySelector('[data-office-content]')?.innerHTML) {
        setContent(id,'<p>Unable to load this workspace.</p>');
      }
    }
  }

  async function handleSubmit(event) {
    const f = event.target.closest('form[data-office-form]');
    if (!f) return;
    event.preventDefault();
    const id=f.dataset.officeModule, action=f.dataset.officeForm;
    const submit=f.querySelector('[type="submit"]');
    if (submit) submit.disabled=true;
    status(id,'Saving…');
    try {
      const fd=new FormData(f);
      if (action==='template-create') {
        await request(officePath(id, '/templates'),{method:'POST',body:JSON.stringify({
          department:id,title:fd.get('title'),template_type:fd.get('template_type'),content:fd.get('content')
        })});
      } else if (action==='document-upload') {
        const file=fd.get('file');
        if (!(file instanceof File) || !file.size) throw new Error('Choose a file to upload.');
        fd.set('department',id);
        await request(officePath(id, '/documents/upload'),{method:'POST',body:fd});
      } else if (action==='counseling-create') {
        const payload=Object.fromEntries(fd.entries());
        await request(officePath(id, '/counseling'),{method:'POST',body:JSON.stringify(payload)});
      }
      f.reset();
      status(id,'Saved successfully.');
      await loadTab(id,activeTab(id));
    } catch(error) {
      status(id,error.message || 'Save failed.',true);
    } finally { if(submit) submit.disabled=false; }
  }

  document.addEventListener('submit',handleSubmit);
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-office-delete-template],[data-office-delete-doc],[data-office-delete-counseling],[data-office-view-template],[data-office-view-doc],[data-office-view-counseling]');
    if(!target)return;
    const id=target.closest('[data-hms-office-module]')?.dataset.hmsOfficeModule ||
      target.closest('.module-view')?.id?.replace(/^mod-/,'');
    if(!id)return;
    try {
      if(target.dataset.officeDeleteTemplate){
        if(!confirm('Delete this template permanently?'))return;
        await request(officePath(id, '/templates/'+target.dataset.officeDeleteTemplate),{method:'DELETE'});
      } else if(target.dataset.officeDeleteDoc){
        if(!confirm('Delete this document record and uploaded file?'))return;
        await request(officePath(id, '/documents/'+target.dataset.officeDeleteDoc),{method:'DELETE'});
      } else if(target.dataset.officeDeleteCounseling){
        if(!confirm('Delete this confidential counseling record?'))return;
        await request(officePath(id, '/counseling/'+target.dataset.officeDeleteCounseling),{method:'DELETE'});
      } else if(target.dataset.officeViewTemplate){
        const d=await request(officePath(id, '/templates/'+target.dataset.officeViewTemplate));
        printRecord(d.template.title,d.template.content,d.template.template_type);
        return;
      } else if(target.dataset.officeViewDoc){
        const d=await request(officePath(id, '/documents/'+target.dataset.officeViewDoc));
        const doc=d.document;
        if(doc.file_url){window.open(doc.file_url,'_blank','noopener');return;}
        printRecord(doc.title,doc.content,doc.document_type);
        return;
      } else if(target.dataset.officeViewCounseling){
        const d=await request(officePath(id, '/counseling/'+target.dataset.officeViewCounseling));
        const r=d.record;
        printRecord('Confidential counseling record — '+r.client_reference,
          `Client: ${r.client_name}\nReference: ${r.client_reference}\nType: ${r.record_type}\nDate: ${r.record_date}\nNotes:\n${r.notes||''}\nOutcome / plan:\n${r.outcome||''}\nFollow-up: ${r.follow_up_date||''}\nReferral: ${r.referral_destination||''}`,'Confidential');
        return;
      }
      await loadTab(id,activeTab(id));
      status(id,'Updated successfully.');
    } catch(error) { status(id,error.message||'Operation failed.',true); }
  });
  function printRecord(title,content,type) {
    const w=window.open('','_blank','width=900,height=700');
    if(!w){alert('Allow pop-ups to view or print this record.');return;}
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>body{font:16px Arial,sans-serif;max-width:850px;margin:35px auto;line-height:1.55}h1{font-size:24px}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>'+esc(title)+'</h1><p>'+esc(type||'')+'</p><pre>'+esc(content||'')+'</pre><button onclick="window.print()">Print</button></body></html>');
    w.document.close();
  }
  function initialize() {
    ensureModuleEntries();
    // Do not inject database-workspace markup. Existing HTML module views and
    // their own forms/tabs remain the sole UI for these modules.
    MODULES.forEach(m=>ensureModuleView(m.id,m.name));
    // Do not switch modules here: this initializer runs before the asynchronous
    // /api/auth/me request has necessarily populated the authenticated user.
    // renderNav() opens the sole authorized module once role resolution finishes.
    // Keep the generated navigation's existing switchModule() path.
    if (typeof renderNav==='function' && document.getElementById('nav-container')) {
      // Existing renderNav uses state.modules and access rules; do not call it
      // again because doing so would unexpectedly change the active module.
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
  // Ensure dynamic module views exist without adding database-workspace UI.
  window.addEventListener('load',initialize,{once:true});
})();


/* Consolidated from original hms.html inline script block 1. */
(function () {
    const button = document.getElementById('export-audit-logs-btn');

    if (!button) return;

    button.addEventListener('click', async function () {
        try {
            button.disabled = true;
            button.textContent = 'Exporting Audit Logs...';

            const response = await fetch(
                '/api/security/audit-logs/export',
                {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers: {
                        'Accept': 'text/csv'
                    }
                }
            );

            if (!response.ok) {
                const errorText = await response.text();

                throw new Error(
                    'Export failed (HTTP ' +
                    response.status +
                    '): ' +
                    errorText.substring(0, 300)
                );
            }

            const blob = await response.blob();

            if (!blob.size) {
                throw new Error('The exported audit log is empty.');
            }

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            link.href = url;
            link.download = 'HMS_System_Audit_Logs.csv';

            document.body.appendChild(link);
            link.click();
            link.remove();

            setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1500);

        } catch (error) {
            console.error('Audit log export failed:', error);
            alert(error.message || 'Unable to export audit logs.');

        } finally {
            button.disabled = false;
            button.textContent = 'Export System Audit Log';
        }
    });
})();


/* Consolidated from original hms.html inline script block 3. */
(function () {
  'use strict';
  const STORAGE_KEY = 'hms_procurement_business_documents_v1';
  const PROCUREMENT_API = '/api/office/procurement';
  let procurementRemoteDocs = [];
  const labels = {
    RFQ:'Request for Quotation', QUOTATION:'Quotation', PURCHASE_ORDER:'Purchase Order',
    SALES_ORDER:'Sales Order', CONTRACT:'Contract', DELIVERY_NOTE:'Delivery Note',
    WAYBILL:'Waybill', INVOICE:'Invoice', GRN:'Goods Received Note',
    PAYMENT_PROOF:'Payment Proof', RECEIPT:'Receipt', CREDIT_NOTE:'Credit Note',
    DEBIT_NOTE:'Debit Note', TAX_INVOICE:'Tax Invoice',
    CUSTOMS_DOCUMENT:'Customs Document', WARRANTY:'Warranty / Service Report'
  };
  const descriptions = {
    RFQ:'For competitive supplier sourcing. Include specifications, quantities, delivery requirements and a response deadline.',
    QUOTATION:'Record the quoted goods or services, prices, validity and commercial terms.',
    PURCHASE_ORDER:'Authorize the purchase of goods or services from a supplier.',
    SALES_ORDER:'Record a customer order and its fulfilment requirements.',
    CONTRACT:'Record the parties, scope, dates, obligations and agreement terms.',
    DELIVERY_NOTE:'Record items dispatched or delivered and obtain acknowledgement.',
    WAYBILL:'Record shipment, carrier, origin, destination and transport details.',
    INVOICE:'Request payment for goods or services supplied.',
    GRN:'Confirm items received and note any discrepancies or inspection findings.',
    PAYMENT_PROOF:'Record the payment method, transaction reference, date and amount.',
    RECEIPT:'Acknowledge money received and identify the related transaction.',
    CREDIT_NOTE:'Record a credit, return, refund or adjustment against a transaction.',
    DEBIT_NOTE:'Record a debit or additional amount due against a transaction.',
    TAX_INVOICE:'Record invoice amounts and tax/charge details.',
    CUSTOMS_DOCUMENT:'Record shipment, origin, destination and customs declaration details.',
    WARRANTY:'Record service inspection, warranty coverage decision and final result.'
  };
  const specificFields = {
    RFQ:[['document_scope','Document Use','select',false,['General Business','Hospital / Healthcare']],['requesting_entity','Requesting Organization / Hospital','text',true],['requesting_contact','Requesting Contact','text',true],['requesting_department','Requesting Department / Ward / Unit','text',false],['cost_centre','Cost Centre','text',false],['budget_code','Budget / Vote Code','text',false],['supplier_contact','Supplier Contact','text',false],['quotation_deadline','Quotation Deadline','date',true],['required_delivery_date','Required Delivery Date','date',false],['delivery_location','Delivery Location','text',false],['incoterms','Incoterms','select',false,['','EXW','FCA','CPT','CIP','DAP','DPU','DDP']],['response_instructions','Response Instructions','textarea',false]],
    QUOTATION:[['valid_until','Quotation Valid Until','date',false],['quote_reference','Quotation Reference','text',false],['delivery_period','Delivery Period','text',false],['payment_terms','Payment Terms','text',false]],
    PURCHASE_ORDER:[['document_scope','Document Use','select',false,['General Business','Hospital / Healthcare']],['requisition_number','Requisition Number','text',false],['requesting_department','Requesting Department / Ward / Unit','text',false],['cost_centre','Cost Centre','text',false],['budget_code','Budget / Vote Code','text',false],['delivery_date','Required Delivery Date','date',false],['delivery_location','Delivery Location','text',false],['buyer_contact','Buyer Contact','text',false]],
    SALES_ORDER:[['customer_order_number','Customer Order Number','text',false],['order_date','Order Date','date',false],['required_date','Required Date','date',false],['delivery_location','Delivery Location','text',false]],
    CONTRACT:[['contract_title','Contract Title','text',true],['effective_date','Effective Date','date',false],['expiry_date','Expiry Date','date',false],['governing_terms','Governing Terms','textarea',false]],
    DELIVERY_NOTE:[['dispatch_date','Dispatch Date','date',false],['delivery_location','Delivery Location','text',false],['vehicle_number','Vehicle / Registration Number','text',false],['received_by','Received By','text',false]],
    WAYBILL:[['carrier_name','Carrier / Transporter','text',false],['vehicle_number','Vehicle / Registration Number','text',false],['origin','Origin','text',false],['destination','Destination','text',false],['shipment_reference','Shipment Reference','text',false],['weight','Weight / Packages','text',false]],
    INVOICE:[['due_date','Payment Due Date','date',false],['tax_number','Tax / TIN Number','text',false],['payment_terms','Payment Terms','text',false]],
    GRN:[['document_scope','Document Use','select',false,['General Business','Hospital / Healthcare']],['purchase_order_number','Purchase Order Number','text',false],['receiving_department','Receiving Department / Store / Ward','text',false],['store_location','Store / Stock Location','text',false],['inspection_officer','Receiving / Inspection Officer','text',false],['received_date','Received Date','date',false],['delivery_note_number','Delivery Note Number','text',false],['inspection_result','Inspection / Discrepancies','textarea',false]],
    PAYMENT_PROOF:[['payment_date','Payment Date','date',false],['payment_method','Payment Method','text',false],['transaction_reference','Transaction Reference','text',false],['paid_to_from','Paid To / From','text',false]],
    RECEIPT:[['receipt_date','Receipt Date','date',false],['payment_method','Payment Method','text',false],['transaction_reference','Transaction Reference','text',false],['received_for','Received For','text',false]],
    CREDIT_NOTE:[['related_invoice','Related Invoice Number','text',false],['adjustment_reason','Reason for Credit','textarea',false]],
    DEBIT_NOTE:[['related_invoice','Related Invoice Number','text',false],['adjustment_reason','Reason for Debit','textarea',false]],
    TAX_INVOICE:[['due_date','Payment Due Date','date',false],['tax_number','Tax / TIN Number','text',false],['tax_rate','Tax Rate (%)','number',false],['tax_exemption_reference','Tax Exemption Reference','text',false]],
    CUSTOMS_DOCUMENT:[['customs_entry_number','Customs Entry / Declaration Number','text',false],['country_of_origin','Country of Origin','text',false],['country_of_destination','Country of Destination','text',false],['hs_code','HS / Tariff Classification','text',false],['shipment_reference','Shipment Reference','text',false],['customs_notes','Customs Notes','textarea',false]],
    WARRANTY:[['document_scope','Document Use','select',false,['General Business','Hospital / Healthcare']],['equipment_item','Equipment / Item','text',false],['hospital_asset_tag','Hospital Asset Tag (if applicable)','text',false],['department_or_ward','Owning Department / Ward','text',false],['serial_number','Serial Number','text',false],['warranty_period','Warranty Period','text',false],['service_date','Service / Inspection Date','date',false],['warranty_decision','Warranty Coverage Decision','textarea',false],['final_result','Final Test / Result','textarea',false],['technician_signatory','Technician Signatory','text',false],['received_by','Customer Acknowledgement','text',false]]
  };
  const byId = id => document.getElementById(id);
  const itemProfiles = {
    RFQ:{items:true,prices:false,title:'Items / specifications requested'}, QUOTATION:{items:true,prices:true,title:'Quoted items / services'}, PURCHASE_ORDER:{items:true,prices:true,title:'Ordered items / services'}, SALES_ORDER:{items:true,prices:true,title:'Customer order items'},
    CONTRACT:{items:false,prices:false,title:'Contract scope'}, DELIVERY_NOTE:{items:true,prices:false,title:'Items dispatched / delivered'}, WAYBILL:{items:true,prices:false,title:'Goods transported'}, INVOICE:{items:true,prices:true,title:'Invoiced items / services'}, GRN:{items:true,prices:false,title:'Items received and inspected'}, PAYMENT_PROOF:{items:false,prices:false,title:'Payment details'}, RECEIPT:{items:false,prices:false,title:'Receipt details'}, CREDIT_NOTE:{items:true,prices:true,title:'Credited items / adjustments'}, DEBIT_NOTE:{items:true,prices:true,title:'Debited items / adjustments'}, TAX_INVOICE:{items:true,prices:true,title:'Taxable items / services'}, CUSTOMS_DOCUMENT:{items:true,prices:true,title:'Declared goods'}, WARRANTY:{items:false,prices:false,title:'Service / inspection details'}
  };
  const profiles = {
    RFQ:{party:'Supplier invited to quote',terms:'Submission / delivery terms',fields:['department','reference','party','party_contact','party_address','description','notes','approved_by']},
    QUOTATION:{party:'Customer / requesting organization',terms:'Payment and delivery terms',fields:['department','reference','party','party_contact','party_address','terms','subtotal','tax','total','notes','approved_by']},
    PURCHASE_ORDER:{party:'Supplier',terms:'Payment and delivery terms',fields:['department','reference','party','party_contact','party_address','terms','subtotal','tax','total','notes','approved_by']},
    SALES_ORDER:{party:'Customer',terms:'Payment and delivery terms',fields:['reference','party','party_contact','party_address','terms','subtotal','tax','total','notes','approved_by']},
    CONTRACT:{party:'Contracting party',terms:'Agreement terms',fields:['reference','party','party_contact','party_address','terms','description','notes','approved_by']},
    DELIVERY_NOTE:{party:'Recipient / receiving organization',terms:'Delivery instructions',fields:['department','reference','party','party_contact','party_address','description','notes','approved_by']},
    WAYBILL:{party:'Consignee / receiving party',terms:'Handling instructions',fields:['reference','party','party_contact','party_address','description','notes','approved_by']},
    INVOICE:{party:'Bill to / customer',terms:'Payment terms',fields:['department','reference','party','party_contact','party_address','terms','subtotal','tax','total','notes','approved_by']},
    GRN:{party:'Supplier',terms:'Receiving / inspection terms',fields:['department','reference','party','party_contact','party_address','description','notes','approved_by']},
    PAYMENT_PROOF:{party:'Payee / payer',terms:'Payment reference / purpose',fields:['reference','party','party_contact','description','notes','approved_by']},
    RECEIPT:{party:'Received from',terms:'Payment purpose',fields:['reference','party','party_contact','description','notes','approved_by']},
    CREDIT_NOTE:{party:'Customer / supplier credited',terms:'Adjustment terms',fields:['department','reference','party','party_contact','party_address','subtotal','tax','total','description','notes','approved_by']},
    DEBIT_NOTE:{party:'Customer / supplier debited',terms:'Adjustment terms',fields:['department','reference','party','party_contact','party_address','subtotal','tax','total','description','notes','approved_by']},
    TAX_INVOICE:{party:'Bill to / customer',terms:'Payment terms',fields:['department','reference','party','party_contact','party_address','terms','subtotal','tax','total','notes','approved_by']},
    CUSTOMS_DOCUMENT:{party:'Importer / exporter / broker',terms:'Customs / shipping terms',fields:['reference','party','party_contact','party_address','description','subtotal','tax','total','notes','approved_by']},
    WARRANTY:{party:'Customer / equipment owner',terms:'Warranty / service terms',fields:['department','reference','party','party_contact','party_address','description','notes','approved_by']}
  };
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const fmtMoney = (currency, value) => `${esc(currency || 'UGX')} ${Number(value || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  function loadDocs() {
    try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data : []; }
    catch (e) { console.warn('Could not read HMS business documents from this browser.', e); return []; }
  }
  async function procurementApi(path, options={}) {
    const response=await fetch(PROCUREMENT_API+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Accept':'application/json',...(options.body&&!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({success:false,error:'The server returned an invalid response.'}));
    if(!response.ok||data.success===false)throw new Error(data.error||data.message||`Request failed (${response.status})`);
    return data;
  }
  function procurementFromDb(row){
    const raw=row.payload??row.content;let doc={};try{doc=typeof raw==='string'?JSON.parse(raw||'{}'):raw||{};}catch(_error){doc={description:String(raw||'')};}
    if(!doc||typeof doc!=='object'||Array.isArray(doc))doc={description:String(doc||'')};
    return {...doc,document_id:`db-${row.id}`,document_type:row.document_type||doc.document_type||'SCANNED_DOCUMENT',document_type_display:row.document_type_display||doc.document_type_display||labels[row.document_type]||row.document_type||'Procurement Document',document_date:row.document_date||doc.document_date||today(),document_number:row.document_number||doc.document_number||'',party_name:row.party_name||doc.party_name||'',department:row.department||doc.department||'',status:row.status||doc.status||'Draft',created_at:row.created_at||doc.created_at||'',file_url:row.file_url||'',original_filename:row.original_filename||row.scan_file_name||'',scan_file_name:row.scan_file_name||row.original_filename||doc.scan_file_name||'',scan_mime_type:row.scan_mime_type||row.mime_type||doc.scan_mime_type||'',is_scanned_document:Boolean(row.is_scanned_document||row.scan_file_name||row.original_filename||doc.is_scanned_document),organization_name:doc.organization_name||'Procurement Document Archive'};
  }
  function saveDocs(docs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(docs)); return true; }
    catch (e) { alert('Unable to save this document in browser storage. Storage may be full or disabled.'); return false; }
  }
  function today() { return new Date().toISOString().slice(0,10); }
  function makeDocumentNumber(type) {
    const prefixes={RFQ:'RFQ',QUOTATION:'QUO',PURCHASE_ORDER:'PO',SALES_ORDER:'SO',CONTRACT:'CON',DELIVERY_NOTE:'DLN',WAYBILL:'WAY',INVOICE:'INV',GRN:'GRN',PAYMENT_PROOF:'PAY',RECEIPT:'RCT',CREDIT_NOTE:'CRN',DEBIT_NOTE:'DBN',TAX_INVOICE:'TIN',CUSTOMS_DOCUMENT:'CUS',WARRANTY:'WAR',SCANNED_DOCUMENT:'SCAN'};
    const prefix=prefixes[type]||'DOC', random=window.crypto?.randomUUID?window.crypto.randomUUID().split('-')[0].toUpperCase():Math.random().toString(36).slice(2,10).toUpperCase();
    return `${prefix}-${today().replace(/-/g,'')}-${random}`;
  }
  function addLineItem(item) {
    const body = byId('hmsBizDocItemsBody');
    if (!body) return;
    const row = document.createElement('tr');
    const data = item || {};
    row.innerHTML = `<td><input class="hms-item-description" aria-label="Item description" placeholder="Item or service" value="${esc(data.description||'')}"></td><td><input aria-label="Specification or code" placeholder="Code / specification" value="${esc(data.specification||'')}"></td><td><input class="hms-item-quantity" aria-label="Quantity" type="number" min="0" step="0.01" value="${esc(data.quantity==null?'1':data.quantity)}"></td><td><input aria-label="Unit" placeholder="unit / box / pack" value="${esc(data.unit||'unit')}"></td><td class="hms-bizdoc-price-col"><input class="hms-item-price" aria-label="Unit price" type="number" min="0" step="0.01" value="${esc(data.unit_price==null?'0':data.unit_price)}"></td><td class="hms-bizdoc-price-col hms-item-amount">0.00</td><td class="no-print"><button type="button" class="btn btn-danger hms-item-remove" aria-label="Remove item">Remove</button></td>`;
    body.appendChild(row);
    row.querySelectorAll('input').forEach(input=>input.addEventListener('input',calculateLineItems));
    row.querySelector('.hms-item-remove').addEventListener('click',()=>{row.remove();calculateLineItems();});
    calculateLineItems();
  }
  function currentLineItems() {
    return Array.from(byId('hmsBizDocItemsBody').querySelectorAll('tr')).map(row=>({
      description:row.querySelector('.hms-item-description').value.trim(),
      specification:row.children[1].querySelector('input').value.trim(),
      quantity:Number(row.querySelector('.hms-item-quantity').value||0),
      unit:row.children[3].querySelector('input').value.trim(),
      unit_price:Number(row.querySelector('.hms-item-price').value||0)
    })).filter(item=>item.description || item.specification);
  }
  function calculateLineItems() {
    const type=byId('hmsBizDocType').value;
    let subtotal=0;
    byId('hmsBizDocItemsBody').querySelectorAll('tr').forEach(row=>{
      const qty=Number(row.querySelector('.hms-item-quantity').value||0);
      const price=Number(row.querySelector('.hms-item-price').value||0);
      const amount=qty*price; subtotal+=amount;
      row.querySelector('.hms-item-amount').textContent=amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    });
    const profile=itemProfiles[type]||{};
    if(profile.prices){byId('hmsBizDocSubtotal').value=subtotal.toFixed(2);}
    byId('hmsBizDocTotal').value=(Number(byId('hmsBizDocSubtotal').value||0)+Number(byId('hmsBizDocTax').value||0)).toFixed(2);
  }
  function applyProfile(type) {
    const profile=profiles[type]||{fields:[]};
    document.querySelectorAll('#hmsBusinessDocumentForm [data-common-field]').forEach(wrap=>{
      const key=wrap.dataset.commonField; wrap.hidden=!profile.fields.includes(key);
      if(wrap.hidden) wrap.querySelectorAll('input,select,textarea').forEach(el=>{el.value='';});
    });
    byId('hmsBizDocPartyLabel').textContent=profile.party||'Other party';
    byId('hmsBizDocTermsLabel').textContent=profile.terms||'Terms';
    const items=itemProfiles[type]||{items:false,prices:false,title:'Items / Services'};
    byId('hmsBizDocLineItemsSection').hidden=!items.items;
    byId('hmsBizDocItemsTitle').textContent=items.title;
    document.querySelectorAll('#hmsBizDocItemsHeader .hms-bizdoc-price-col').forEach(el=>el.hidden=!items.prices);
    byId('hmsBizDocItemsBody').querySelectorAll('.hms-bizdoc-price-col').forEach(el=>el.hidden=!items.prices);
    byId('hmsBizDocPartySectionTitle').textContent=({RFQ:'Supplier details',QUOTATION:'Customer details',PURCHASE_ORDER:'Supplier details',SALES_ORDER:'Customer details',INVOICE:'Customer / billed party',TAX_INVOICE:'Customer / billed party',GRN:'Supplier details',DELIVERY_NOTE:'Delivery recipient',WAYBILL:'Consignee details',PAYMENT_PROOF:'Payment parties',RECEIPT:'Payer details',CONTRACT:'Contracting party',WARRANTY:'Customer / equipment owner'}[type]||'Other party details');
    byId('hmsBizDocItemsBody').innerHTML='';
    if(items.items) addLineItem();
    const scopeField=byId('hms-specific-document_scope');
    if(scopeField && !scopeField.value) scopeField.value='General Business';
    const hospitalOnlyNames=['requesting_department','cost_centre','budget_code','receiving_department','store_location','inspection_officer','hospital_asset_tag','department_or_ward'];
    const applyScope=()=>{
      const hospital=scopeField && scopeField.value==='Hospital / Healthcare';
      hospitalOnlyNames.forEach(name=>{const el=byId('hms-specific-'+name);if(el){const wrap=el.closest('.form-group');if(wrap)wrap.hidden=!hospital;if(!hospital)el.value='';}});
    };
    if(scopeField) scopeField.addEventListener('change',applyScope);
    applyScope();
  }
  function buildSpecificFields(type, values) {
    const host = byId('hmsBizDocSpecificFields');
    host.innerHTML = '';
    (specificFields[type] || []).forEach(field => {
      const [name,label,typeInput,required,options] = field;
      const value = values && values[name] != null ? values[name] : '';
      const wrap = document.createElement('div');
      wrap.className = 'form-group' + (typeInput === 'textarea' ? ' hms-bizdoc-wide' : '');
      let control = '';
      if (typeInput === 'select') {
        control = `<select name="${esc(name)}" id="hms-specific-${esc(name)}" ${required?'required':''}>${(options || []).map(opt => `<option value="${esc(opt)}" ${String(value)===String(opt)?'selected':''}>${esc(opt || 'Select')}</option>`).join('')}</select>`;
      } else if (typeInput === 'textarea') {
        control = `<textarea name="${esc(name)}" id="hms-specific-${esc(name)}" rows="3" ${required?'required':''}>${esc(value)}</textarea>`;
      } else {
        control = `<input type="${esc(typeInput)}" name="${esc(name)}" id="hms-specific-${esc(name)}" ${typeInput==='number'?'min="0" step="0.01"':''} value="${esc(value)}" ${required?'required':''}>`;
      }
      wrap.innerHTML = `<label for="hms-specific-${esc(name)}">${esc(label)}${required?' *':''}</label>${control}`;
      host.appendChild(wrap);
    });
  }
  function chooseType(type) {
    if (!labels[type]) return;
    byId('hmsBizDocType').value = type;
    byId('hmsBusinessDocumentHeading').textContent = labels[type];
    byId('hmsBusinessDocumentDescription').textContent = descriptions[type] || '';
    document.querySelectorAll('#hmsBusinessDocumentTypes .hms-bizdoc-type').forEach(btn => btn.classList.toggle('selected',btn.dataset.docType===type));
    buildSpecificFields(type);
    applyProfile(type);
    if (!byId('hmsBizDocDate').value) byId('hmsBizDocDate').value = today();
    byId('hmsBizDocPreviewPanel').hidden = true;
    byId('hmsBizDocNumber').value = makeDocumentNumber(type);
    byId('hmsBusinessDocumentFormCard').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function formData() {
    const form = byId('hmsBusinessDocumentForm');
    const data = {};
    new FormData(form).forEach((value,key) => { data[key] = String(value).trim(); });
    data.document_type = byId('hmsBizDocType').value;
    data.line_items = currentLineItems();
    data.hospital_name = data.organization_name || 'HOSPITAL / ORGANIZATION';
    data.document_type_display = labels[data.document_type] || 'Business Document';
    data.document_number = data.document_number || makeDocumentNumber(data.document_type);
    data.document_date = data.document_date || today();
    data.status = data.status || 'Draft';
    data.currency = data.currency || 'UGX';
    data.subtotal = Number(data.subtotal || 0);
    data.tax = Number(data.tax || 0);
    data.grand_total = Math.max(0, data.subtotal + data.tax);
    return data;
  }
  function collectFormValues() {
    const result = {};
    byId('hmsBusinessDocumentForm').querySelectorAll('input,select,textarea').forEach(el => {
      if (el.name) result[el.name] = el.value;
    });
    return result;
  }
  function renderDocument(doc) {
    if (doc.is_scanned_document) {
      const fileView = doc.file_url && String(doc.scan_mime_type||'').startsWith('image/')
        ? `<div class="hms-paper-block"><img src="${esc(doc.file_url)}" alt="Uploaded procurement document" style="max-width:100%;height:auto"></div>`
        : doc.file_url && doc.scan_mime_type === 'application/pdf'
          ? `<div class="hms-paper-block"><iframe title="Uploaded procurement PDF" src="${esc(doc.file_url)}" style="width:100%;height:70vh;border:1px solid #cbd5e1"></iframe><p><a href="${esc(doc.file_url)}" target="_blank" rel="noopener">Open or download ${esc(doc.scan_file_name||'PDF')}</a></p></div>`
          : doc.file_url
            ? `<div class="hms-paper-block"><a href="${esc(doc.file_url)}" target="_blank" rel="noopener">Open or download ${esc(doc.scan_file_name||'uploaded file')}</a></div>`
            : doc.scan_data_url && String(doc.scan_mime_type||'').startsWith('image/')
        ? `<div class="hms-paper-block"><img src="${esc(doc.scan_data_url)}" alt="Scanned document" style="max-width:100%;height:auto"></div>`
        : doc.scan_data_url && doc.scan_mime_type === 'application/pdf'
          ? `<div class="hms-paper-block"><a href="${esc(doc.scan_data_url)}" target="_blank" rel="noopener">Open scanned PDF: ${esc(doc.scan_file_name||'document.pdf')}</a></div>`
          : `<div class="hms-paper-block">Original scan preview is not available in this record.</div>`;
      return `<div class="hms-bizdoc-paper"><div class="hms-paper-top"><div><h2 class="hms-paper-title">${esc(doc.organization_name||'Procurement Document')}</h2><div class="hms-paper-muted">Scanned document record</div></div><div><h2 class="hms-paper-title">${esc(doc.document_type_display||'Scanned Document')}</h2><div><strong>No:</strong> ${esc(doc.document_number||'—')}</div><div><strong>Date:</strong> ${esc(doc.document_date||'—')}</div></div></div><div class="hms-paper-meta"><div><span class="hms-paper-label">Title</span><div>${esc(doc.scan_title||doc.description||'Scanned document')}</div></div><div><span class="hms-paper-label">Supplier / Organization</span><div>${esc(doc.party_name||'—')}</div></div><div><span class="hms-paper-label">Department</span><div>${esc(doc.department||'—')}</div></div><div><span class="hms-paper-label">File</span><div>${esc(doc.scan_file_name||'—')}</div></div><div><span class="hms-paper-label">Notes</span><div>${esc(doc.notes||'—')}</div></div></div>${fileView}<div class="hms-paper-signatures"><div>Filed by: __________________________</div><div>Reviewed by: _______________________</div></div></div>`;
    }
    const excluded=['document_type','document_type_display','document_number','document_date','department','currency','reference','status','party_name','party_contact','party_address','terms','description','subtotal','tax','grand_total','notes','prepared_by','approved_by','document_id','created_at','updated_at','line_items','organization_name','organization_phone','organization_email','organization_tax_number','organization_address','hospital_name'];
    const extras=Object.keys(doc).filter(key=>!excluded.includes(key)&&doc[key]!==''&&doc[key]!=null&&typeof doc[key]!=='object');
    const extraHtml=extras.map(key=>`<div><span class="hms-paper-label">${esc(key.replace(/_/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase()))}</span><div>${esc(doc[key])}</div></div>`).join('');
    const hasPrices=!!(itemProfiles[doc.document_type]||{}).prices;
    const itemRows=(doc.line_items||[]).map(item=>`<tr><td>${esc(item.description||'—')}</td><td>${esc(item.specification||'—')}</td><td>${esc(item.quantity??'')}</td><td>${esc(item.unit||'')}</td>${hasPrices?`<td>${fmtMoney(doc.currency,item.unit_price)}</td><td>${fmtMoney(doc.currency,Number(item.quantity||0)*Number(item.unit_price||0))}</td>`:''}</tr>`).join('');
    const itemTable=itemRows?`<div class="hms-paper-block"><div class="hms-paper-label">${esc((itemProfiles[doc.document_type]||{}).title||'Items / Services')}</div><table class="hms-paper-items"><thead><tr><th>Description</th><th>Specification / Code</th><th>Quantity</th><th>Unit</th>${hasPrices?'<th>Unit Price</th><th>Amount</th>':''}</tr></thead><tbody>${itemRows}</tbody></table></div>`:'';
    const orgName=doc.organization_name||doc.hospital_name||'HOSPITAL / ORGANIZATION';
    const orgDetails=[doc.organization_address,doc.organization_phone,doc.organization_email,doc.organization_tax_number?`Tax / Registration: ${doc.organization_tax_number}`:''].filter(Boolean).map(esc).join(' · ');
    const isPriceDoc=hasPrices || ['INVOICE','TAX_INVOICE','QUOTATION','PURCHASE_ORDER','SALES_ORDER','CREDIT_NOTE','DEBIT_NOTE','PAYMENT_PROOF','RECEIPT'].includes(doc.document_type);
    return `<div class="hms-paper-top"><div><h2 class="hms-paper-title">${esc(orgName)}</h2><div class="hms-paper-muted">${orgDetails||'Business and Hospital Documentation'}</div><div class="hms-paper-muted">${esc(doc.department||'')}</div></div><div style="text-align:right"><h2 class="hms-paper-title">${esc(doc.document_type_display||labels[doc.document_type]||'Business Document')}</h2><div><strong>No:</strong> ${esc(doc.document_number||'—')}</div><div><strong>Date:</strong> ${esc(doc.document_date||'—')}</div><div><strong>Status:</strong> ${esc(doc.status||'Draft')}</div></div></div>
    <div class="hms-paper-meta"><div><span class="hms-paper-label">${esc((profiles[doc.document_type]||{}).party||'Party')}</span><div>${esc(doc.party_name||'—')}</div></div><div><span class="hms-paper-label">Contact</span><div>${esc(doc.party_contact||'—')}</div></div><div><span class="hms-paper-label">Party Address</span><div>${esc(doc.party_address||'—')}</div></div><div><span class="hms-paper-label">Reference</span><div>${esc(doc.reference||'—')}</div></div>${doc.terms?`<div><span class="hms-paper-label">${esc((profiles[doc.document_type]||{}).terms||'Terms')}</span><div>${esc(doc.terms)}</div></div>`:''}</div>
    ${extraHtml?`<div class="hms-paper-meta">${extraHtml}</div>`:''}${itemTable}
    ${doc.description?`<div class="hms-paper-block"><div class="hms-paper-label">Purpose / Narrative / Scope</div><div>${esc(doc.description)}</div></div>`:''}
    ${isPriceDoc?`<div class="hms-paper-total"><div><span>Subtotal</span><strong>${fmtMoney(doc.currency,doc.subtotal)}</strong></div><div><span>Tax / Charges / Adjustments</span><strong>${fmtMoney(doc.currency,doc.tax)}</strong></div><div style="font-size:1.08rem;border-top:1px solid #cbd5e1;padding-top:8px"><span>Grand Total</span><strong>${fmtMoney(doc.currency,doc.grand_total)}</strong></div></div>`:''}
    ${doc.notes?`<div class="hms-paper-block"><div class="hms-paper-label">Notes / Special Conditions</div><div>${esc(doc.notes)}</div></div>`:''}
    <div class="hms-paper-signatures"><div>Prepared by: ${esc(doc.prepared_by||'')}</div><div>Approved / Authorized by: ${esc(doc.approved_by||'')}</div></div>`;
  }
  function showPreview(doc) {
    const panel = byId('hmsBizDocPreviewPanel');
    byId('hmsBizDocPreviewContent').innerHTML = renderDocument(doc);
    panel.hidden = false;
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function printPaper(html) {
    const old = byId('hmsBizDocPrintTarget');
    if (old) old.remove();
    const target = document.createElement('div');
    target.id = 'hmsBizDocPrintTarget';
    target.className = 'hms-bizdoc-paper';
    target.innerHTML = html;
    document.body.appendChild(target);
    document.body.classList.add('hms-bizdoc-printing');
    window.print();
    document.body.classList.remove('hms-bizdoc-printing');
    target.remove();
  }
  async function refreshStore() {
    const search = (byId('hmsBizDocStoreSearch').value || '').toLowerCase().trim();
    const type = byId('hmsBizDocStoreType').value;
    const from = byId('hmsBizDocStoreDateFrom').value;
    const to = byId('hmsBizDocStoreDateTo').value;
    const month = byId('hmsBizDocStoreMonth').value;
    const year = byId('hmsBizDocStoreYear').value.trim();
    let remoteError='';
    await hmsWaitForAuthRole();
    if (hmsRoleMayCall('/api/office/procurement')) {
      try{const data=await procurementApi('/documents');procurementRemoteDocs=(data.documents||[]).map(procurementFromDb);}catch(error){remoteError=error.message;procurementRemoteDocs=[];}
    } else {
      procurementRemoteDocs=[];
      remoteError='Procurement documents are not assigned to this account.';
    }
    const docs = [...loadDocs(),...procurementRemoteDocs].sort((a,b) => String(b.document_date || '').localeCompare(String(a.document_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const filtered = docs.filter(doc => {
      const text = Object.values(doc).filter(v=>typeof v!=='object').join(' ').toLowerCase();
      const date = String(doc.document_date||'');
      return (!search || text.includes(search)) && (!type || doc.document_type === type) && (!from || date >= from) && (!to || date <= to) && (!month || date.slice(5,7) === month) && (!year || date.slice(0,4) === year);
    });
    byId('hmsBizDocStoreCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'document' : 'documents'}`;
    const host = byId('hmsBizDocStoreList');
    if (!filtered.length) {
      host.innerHTML = `<div class="hms-bizdoc-empty">${docs.length ? 'No documents match the selected filters.' : remoteError ? `Could not load Procurement documents: ${esc(remoteError)}` : 'No documents have been saved yet.'}</div>`;
      return;
    }
    const groups = {};
    filtered.forEach(doc => { const day = doc.document_date || 'Date not recorded'; (groups[day] ||= []).push(doc); });
    host.innerHTML = Object.keys(groups).sort((a,b) => b.localeCompare(a)).map(day => `<section class="hms-bizdoc-date-group"><div class="hms-bizdoc-date-heading">${esc(day)}</div>${groups[day].map(doc => `<article class="hms-bizdoc-document-row"><div class="hms-bizdoc-row-main"><div class="hms-bizdoc-row-title">${esc(doc.document_type_display || labels[doc.document_type] || 'Business Document')} — ${esc(doc.document_number || '—')}</div><div class="hms-bizdoc-row-meta">Party: ${esc(doc.party_name || '—')} · Department: ${esc(doc.department || '—')}<br>Status: ${esc(doc.status || 'Draft')} · Reference: ${esc(doc.reference || '—')}<br>Total: ${fmtMoney(doc.currency,doc.grand_total)}</div></div><div class="hms-bizdoc-row-actions"><button type="button" class="btn btn-primary" data-view-doc="${esc(doc.document_id)}">View</button><button type="button" class="btn" data-print-doc="${esc(doc.document_id)}">Print</button><button type="button" class="btn btn-danger" data-delete-doc="${esc(doc.document_id)}">Delete</button></div></article>`).join('')}</section>`).join('');
  }
  let procurementScanData = null;
  let procurementScanObjectUrl = null;
  function clearProcurementScanner() {
    const form = byId('hmsProcurementScannerForm');
    if (form) form.reset();
    procurementScanData = null;
    if (procurementScanObjectUrl) { URL.revokeObjectURL(procurementScanObjectUrl); procurementScanObjectUrl = null; }
    byId('hmsProcScanPreview').innerHTML = '<div class="hms-bizdoc-empty">Select a PDF or image to preview it here.</div>';
    byId('hmsProcScanStatus').hidden = false;
    byId('hmsProcScanStatus').textContent = 'No file selected.';
    byId('hmsProcScanPreview').hidden = false;
    byId('hmsProcScanDate').value = today();
  }
  function initProcurementScanner() {
    const form = byId('hmsProcurementScannerForm');
    if (!form) return;
    byId('hmsProcScanDate').value = today();
    byId('hmsProcScanFile').addEventListener('change', () => {
      const file = byId('hmsProcScanFile').files[0];
      procurementScanData = null;
      if (procurementScanObjectUrl) URL.revokeObjectURL(procurementScanObjectUrl);
      procurementScanObjectUrl = null;
      byId('hmsProcScanStatus').hidden=false;byId('hmsProcScanPreview').hidden=false;
      if (!file) { byId('hmsProcScanPreview').innerHTML='<div class="hms-bizdoc-empty">Select a PDF or image to preview it here.</div>'; byId('hmsProcScanStatus').textContent='No file selected.'; return; }
      if (!/\.(pdf|png|jpe?g|webp|tiff?|doc|docx|xls|xlsx|odt|ods|txt|rtf)$/i.test(file.name)) { alert('Choose a supported PDF, image, Word, spreadsheet or text document.'); byId('hmsProcScanFile').value=''; return; }
      if (file.size > 100 * 1024 * 1024) { alert('File is too large. Maximum upload size is 100 MB.'); byId('hmsProcScanFile').value=''; return; }
      procurementScanObjectUrl=URL.createObjectURL(file);
      procurementScanData = {name:file.name,mime:file.type||'application/octet-stream',size:file.size};
      byId('hmsProcScanStatus').textContent = `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB · Ready to upload (100 MB maximum)`;
      if (file.type.startsWith('image/')) byId('hmsProcScanPreview').innerHTML = `<img src="${esc(procurementScanObjectUrl)}" alt="Scanned document preview">`;
      else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) byId('hmsProcScanPreview').innerHTML = `<iframe title="Scanned PDF preview" src="${esc(procurementScanObjectUrl)}"></iframe><p><a href="${esc(procurementScanObjectUrl)}" target="_blank" rel="noopener">Open PDF in a new tab</a></p>`;
      else byId('hmsProcScanPreview').innerHTML = `<div class="hms-bizdoc-empty">${esc(file.name)} is ready to upload. Preview it after upload if your browser supports this file type.</div>`;
    });
    byId('hmsProcScanClear').addEventListener('click',clearProcurementScanner);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!procurementScanData) { alert('Choose and preview a PDF or image before saving.'); return; }
      if (!form.reportValidity()) return;
      const file=byId('hmsProcScanFile').files[0],button=byId('hmsProcScanSave'),oldText=button.textContent;
      if(!file)return;
      const payload=new FormData();payload.append('file',file);payload.append('title',byId('hmsProcScanTitle').value.trim()||'Scanned procurement document');payload.append('document_type',byId('hmsProcScanType').value||'SCANNED_DOCUMENT');payload.append('document_date',byId('hmsProcScanDate').value||today());
      payload.append('content',JSON.stringify({document_type_display:'General Scanned Document',document_date:byId('hmsProcScanDate').value||today(),department:byId('hmsProcScanDepartment').value.trim(),party_name:byId('hmsProcScanParty').value.trim(),organization_name:'Procurement Document Archive',status:'Scanned / Filed',description:byId('hmsProcScanTitle').value.trim()||'Scanned procurement document',scan_title:byId('hmsProcScanTitle').value.trim()||'Scanned procurement document',notes:byId('hmsProcScanNotes').value.trim(),currency:'UGX',subtotal:0,tax:0,grand_total:0,is_scanned_document:true}));
      button.disabled=true;button.textContent='Uploading to database…';byId('hmsProcScanStatus').textContent='Uploading '+file.name+'…';
      try{const saved=await procurementApi('/documents/upload',{method:'POST',body:payload});await refreshStore();alert(`Document uploaded. Reference: ${procurementFromDb(saved.document).document_number}`);clearProcurementScanner();}
      catch(error){byId('hmsProcScanStatus').textContent='Upload failed: '+error.message;alert('Document upload failed: '+error.message);}
      finally{button.disabled=false;button.textContent=oldText;}
    });
  }
  function viewStored(id) {
    const doc = [...procurementRemoteDocs,...loadDocs()].find(item => String(item.document_id) === String(id));
    if (!doc) return;
    byId('hmsBizDocStoredViewContent').innerHTML = renderDocument(doc);
    byId('hmsBizDocStoredView').hidden = false;
    byId('hmsBizDocStoredView').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function populateTypeFilter() {
    const select = byId('hmsBizDocStoreType');
    select.innerHTML = '<option value="">All Document Types</option>' + '<option value="SCANNED_DOCUMENT">General Scanned Document</option>' + Object.keys(labels).map(type => `<option value="${type}">${esc(labels[type])}</option>`).join('');
  }
  document.addEventListener('DOMContentLoaded', function () {
    if (!byId('hmsBusinessDocumentForm')) return;
    byId('hmsBizDocDate').value = today();
    populateTypeFilter();
    refreshStore();
    initProcurementScanner();
    document.querySelectorAll('#hmsBusinessDocumentTypes .hms-bizdoc-type').forEach(button => button.addEventListener('click',() => chooseType(button.dataset.docType)));
    ['hmsBizDocSubtotal','hmsBizDocTax'].forEach(id => byId(id).addEventListener('input',calculateLineItems));
    byId('hmsBizDocAddItem').addEventListener('click',()=>addLineItem());
    byId('hmsBizDocPreviewBtn').addEventListener('click',() => {
      const form = byId('hmsBusinessDocumentForm');
      if (!byId('hmsBizDocType').value) { alert('Please select a document type first.'); return; }
      if (!form.reportValidity()) return;
      const doc = formData();
      showPreview(doc);
    });
    byId('hmsBizDocSaveBtn').addEventListener('click',async () => {
      const form = byId('hmsBusinessDocumentForm');
      if (!byId('hmsBizDocType').value) { alert('Please select a document type first.'); return; }
      if (!form.reportValidity()) return;
      const doc = formData();
      const button=byId('hmsBizDocSaveBtn');button.disabled=true;const oldText=button.textContent;button.textContent='Saving to database…';
      try{
        const saved=await procurementApi('/documents',{method:'POST',body:JSON.stringify({title:doc.title||doc.document_type_display,document_type:doc.document_type,document_date:doc.document_date,content:JSON.stringify(doc)})});
        const stored=procurementFromDb(saved.document);showPreview(stored);await refreshStore();alert(`Document saved to the Procurement Document Store. Reference: ${stored.document_number}`);
      }catch(error){alert('Document could not be saved: '+error.message);}
      finally{button.disabled=false;button.textContent=oldText;}
    });
    byId('hmsBizDocClearBtn').addEventListener('click',() => setTimeout(() => {
      byId('hmsBizDocType').value = '';
      byId('hmsBusinessDocumentHeading').textContent = 'Select a Document Type';
      byId('hmsBusinessDocumentDescription').textContent = 'Choose one of the document types above to begin.';
      byId('hmsBizDocSpecificFields').innerHTML = '';
      byId('hmsBizDocItemsBody').innerHTML = '';
      document.querySelectorAll('#hmsBusinessDocumentForm [data-common-field]').forEach(wrap=>wrap.hidden=false);
      byId('hmsBizDocPreviewPanel').hidden = true;
      document.querySelectorAll('#hmsBusinessDocumentTypes .hms-bizdoc-type').forEach(btn => btn.classList.remove('selected'));
      byId('hmsBizDocDate').value = today();
    },0));
    byId('hmsBizDocPrintPreviewBtn').addEventListener('click',() => printPaper(byId('hmsBizDocPreviewContent').innerHTML));
    byId('hmsBizDocClosePreviewBtn').addEventListener('click',() => { byId('hmsBizDocPreviewPanel').hidden = true; });
    ['hmsBizDocStoreSearch','hmsBizDocStoreType','hmsBizDocStoreDateFrom','hmsBizDocStoreDateTo','hmsBizDocStoreMonth','hmsBizDocStoreYear'].forEach(id => byId(id).addEventListener(id==='hmsBizDocStoreSearch'?'input':'change',refreshStore));
    byId('hmsBizDocStoreClear').addEventListener('click',() => { byId('hmsBizDocStoreSearch').value=''; byId('hmsBizDocStoreType').value=''; byId('hmsBizDocStoreDateFrom').value=''; byId('hmsBizDocStoreDateTo').value=''; byId('hmsBizDocStoreMonth').value=''; byId('hmsBizDocStoreYear').value=''; refreshStore(); });
    byId('hmsBizDocStoreList').addEventListener('click',async event => {
      const view = event.target.closest('[data-view-doc]');
      const print = event.target.closest('[data-print-doc]');
      const del = event.target.closest('[data-delete-doc]');
      if (view) viewStored(view.dataset.viewDoc);
      if (print) { const doc=[...procurementRemoteDocs,...loadDocs()].find(item=>String(item.document_id)===String(print.dataset.printDoc)); if(doc) printPaper(renderDocument(doc)); }
      if (del) {
        if (!confirm('Delete this saved document from the Procurement Document Store? This cannot be undone.')) return;
        try{
          if(String(del.dataset.deleteDoc).startsWith('db-')) await procurementApi('/documents/'+encodeURIComponent(String(del.dataset.deleteDoc).slice(3)),{method:'DELETE'});
          else saveDocs(loadDocs().filter(item=>String(item.document_id)!==String(del.dataset.deleteDoc)));
          await refreshStore();
        }catch(error){alert('Could not delete document: '+error.message);}
      }
    });
    byId('hmsBizDocStoredPrint').addEventListener('click',() => printPaper(byId('hmsBizDocStoredViewContent').innerHTML));
    byId('hmsBizDocStoredClose').addEventListener('click',() => { byId('hmsBizDocStoredView').hidden = true; });
  });
})();


/* Consolidated from original hms.html inline script block 6. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const officeKey='hms_secretariate_documents_v1';
  let officeDbDocs=[];
  async function officeApi(path, options={}){const response=await fetch('/api/office/secretariate'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});const data=await response.json().catch(()=>({success:false,error:'The server returned an invalid response.'}));if(!response.ok||data.success===false)throw new Error(data.error||data.message||('Request failed ('+response.status+')'));return data;}
  function officeFromDb(row){let d={};const raw=row.content;if(raw&&typeof raw==='object'){d=raw;}else if(typeof raw==='string'){try{d=JSON.parse(raw||'{}');if(!d||typeof d!=='object')d={body:String(raw||'')};}catch(e){d={body:raw||''};}}else{d={};}if(Array.isArray(d))d={body:d.map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join('\n')};if(!d||typeof d!=='object')d={body:String(d??'')};d.id=String(row.id);d.type=row.document_type||d.type||'';d.type_title=row.document_type_display||d.type_title||officeDefs[d.type]?.title||row.document_type||'Secretariate Document';d.subject=d.subject||row.title||'';d.number=d.number||row.document_number||'';d.date=d.date||row.document_date||'';d.saved_at=d.saved_at||row.created_at||'';d.author=d.author||row.author||row.created_by||'';d.recipient=d.recipient||row.recipient||'';d.organization=d.organization||row.organization||'';return d;}
  async function loadOfficeDbDocs(){const data=await officeApi('/documents');officeDbDocs=(data.documents||[]).map(officeFromDb);return officeDbDocs;}
  const gcKeys={intake:'intake',sessions:'sessions',follow:'follow-up',resources:'resources'};
  const gcRows={intake:[],sessions:[],follow:[],resources:[]};
  let gcDoctorReferrals=[];
  let gcPatients=[];
  let gcStoreFilter='';
  let gcStoreTypeFilter='all';
  const gcApi=async(path,options={})=>{const base=String(path).startsWith('/referrals')||String(path).startsWith('/patients')?'/api/office/guidance':'/api/office/guidance/counseling';const r=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok||d.success===false)throw new Error(d.error||'Guidance & Counseling request failed.');return d};
  function gcDecode(o){let x={};if(o.notes&&typeof o.notes==='object')x=o.notes;else{try{x=JSON.parse(o.notes||'{}')}catch(e){x={notes:o.notes||''}}}if(!x||typeof x!=='object'||Array.isArray(x))x={notes:String(o.notes||'')};return {...x,_details:x,_record_meta:{database_id:o.id,client_reference:o.client_reference,client_name:o.client_name,record_type:o.record_type,record_date:o.record_date,follow_up_date:o.follow_up_date,referral_destination:o.referral_destination,outcome:o.outcome,created_by:o.created_by,created_at:o.created_at,updated_at:o.updated_at},id:o.id,record_type:o.record_type,reference:o.client_reference,case_label:o.client_name,date:o.record_date||'',due_date:x.due_date||o.follow_up_date||'',action:x.action||x.concern||x.summary||x.notes||o.notes||'',title:x.title||o.client_reference,category:x.category||o.record_type||'',contact:x.contact||'',details:x.details||x.notes||o.notes||'',description:x.description||'',status:x.status||o.outcome||'Saved',saved_at:o.created_at||''}}
  async function gcLoadAll(){await hmsWaitForAuthRole();if(!hmsRoleMayCall('/api/office/guidance')){gcPatients=[];gcDoctorReferrals=[];Object.keys(gcRows).forEach(key=>gcRows[key]=[]);['gcJourneyStore','gcStoredRecords'].forEach(id=>{if($(id))$(id).innerHTML='<p class="hms-office-empty">Guidance &amp; Counseling is not assigned to this account.</p>'});return;}const patients=await gcApi('/patients');gcPatients=patients.patients||[];for(const [key,kind] of Object.entries(gcKeys)){const d=await gcApi('?kind='+encodeURIComponent(kind));gcRows[key]=(d.records||[]).map(gcDecode)}const referrals=await gcApi('/referrals');gcDoctorReferrals=referrals.referrals||[];refreshGc()}
  const officeDefs={
    statement:{title:'Statement',prompt:'State the facts or position clearly, accurately and in chronological order where relevant.',recipient:'Recipient / intended audience',subject:'Statement title',body:'Statement text',bodyHint:'I/We state as follows...',specific:[['statement_type','Statement type','select','Official statement|Personal statement|Organizational statement|Witness statement|Other'],['on_behalf_of','Made on behalf of','text'],['period','Period / date of events','text']]},
    letter:{title:'Letter',prompt:'Use an appropriate greeting, clear paragraphs and a suitable closing.',recipient:'Recipient name and address',subject:'Subject',body:'Letter body',bodyHint:'Dear ...,\n\nWrite your message here... ',specific:[['letter_type','Letter type','select','Formal|Informal|Request|Complaint|Inquiry|Application|Thank-you|Apology|Invitation|Other'],['salutation','Salutation','text'],['closing','Closing','text']]},
    memo:{title:'Memorandum',prompt:'For internal communication. State the purpose and action required.',recipient:'To',subject:'Subject',body:'Message',bodyHint:'Purpose, background and required action...',specific:[['from','From','text'],['cc','CC','text'],['deadline','Action deadline','date']]},
    circular:{title:'Circular',prompt:'For distributing the same official message to multiple recipients.',recipient:'Distribution / audience',subject:'Circular subject',body:'Circular text',bodyHint:'Purpose, information and what recipients need to do...',specific:[['effective_date','Effective from','date'],['applies_to','Applies to','text'],['contact_person','Contact person','text']]},
    report:{title:'Report',prompt:'Organize the report into background, findings, actions and conclusion.',recipient:'Submitted to',subject:'Report title',body:'Background, findings and details',bodyHint:'1. Background\n2. Findings\n3. Details...',specific:[['report_type','Report type','select','Incident|Activity|Inspection|Progress|Field visit|Investigation|Other'],['reporting_period','Reporting period','text'],['location','Location / department','text']]},
    speech:{title:'Speech',prompt:'Consider the audience, occasion, opening, main points and closing.',recipient:'Audience / occasion',subject:'Speech title',body:'Speech text',bodyHint:'Greeting, opening, main message, conclusion...',specific:[['speech_type','Speech type','select','Welcome|Farewell|Informative|Persuasive|Ceremonial|Vote of thanks|Other'],['occasion','Occasion','text'],['estimated_minutes','Estimated duration (minutes)','number']]},
    minutes:{title:'Minutes of Meeting',prompt:'Record decisions and actions objectively, not a word-for-word transcript.',recipient:'Committee / group',subject:'Meeting title',body:'Discussion points and proceedings',bodyHint:'Agenda item 1: Discussion...\nAgenda item 2: Discussion...',specific:[['meeting_date','Meeting date','date'],['venue','Venue / platform','text'],['chairperson','Chairperson','text'],['secretary','Minute taker','text'],['attendance','Present / apologies','textarea']]},
    evaluation:{title:'Evaluation',prompt:'Describe criteria, evidence, strengths, gaps and recommendations.',recipient:'Evaluator / recipient',subject:'Evaluation title',body:'Evaluation findings',bodyHint:'Purpose, criteria, evidence and findings...',specific:[['subject_evaluated','Person / activity / service evaluated','text'],['evaluation_period','Evaluation period','text'],['rating','Overall rating','select','Excellent|Good|Satisfactory|Needs improvement|Unsatisfactory|Not rated']]},
    interview:{title:'Interview Record',prompt:'Record consent where required, questions, responses and next steps fairly.',recipient:'Interview purpose / recipient',subject:'Interview title',body:'Questions and answers',bodyHint:'Q1: ...\nA1: ...',specific:[['interviewee','Interviewee / code','text'],['interviewer','Interviewer','text'],['interview_date','Interview date','date'],['interview_type','Interview type','select','Structured|Semi-structured|Unstructured|Panel|Other']]},
    questionnaire:{title:'Questionnaire',prompt:'Use clear, neutral questions and include response options where appropriate.',recipient:'Target respondents',subject:'Questionnaire title',body:'Questions and response options',bodyHint:'1. Question...\n   ☐ Option A  ☐ Option B\n2. ...',specific:[['purpose','Purpose','text'],['anonymous','Responses anonymous?','select','Yes|No'],['closing_date','Response deadline','date']]},
    manual:{title:'Manual / Procedure',prompt:'State the purpose, scope, responsible roles, steps and safety notes.',recipient:'Intended users',subject:'Manual title',body:'Procedure / instructions',bodyHint:'1. Purpose\n2. Scope\n3. Responsibilities\n4. Procedure steps...',specific:[['version','Version','text'],['owner','Process owner','text'],['review_date','Review date','date']]},
    directions:{title:'Directions',prompt:'Give ordered, unambiguous steps and recognizable landmarks or checkpoints.',recipient:'Person following directions',subject:'Destination / route',body:'Directions',bodyHint:'Start at...\n1. ...\n2. ...\nIf you reach..., you have gone too far.',specific:[['starting_point','Starting point','text'],['destination','Destination','text'],['accessibility','Accessibility / safety notes','text']]},
    campaign:{title:'Campaign Message',prompt:'Use a clear call to action, audience-appropriate language and verified information.',recipient:'Target audience',subject:'Campaign / theme',body:'Campaign message',bodyHint:'Key message, supporting facts and action the audience should take...',specific:[['campaign_goal','Campaign goal','text'],['channel','Channel','select','Poster|SMS|Email|Radio|Social media|Community meeting|Other'],['call_to_action','Call to action','text']]},
    warning:{title:'Warning Notice',prompt:'State the hazard, who is affected, required precautions and contact point.',recipient:'Persons affected',subject:'Warning title',body:'Warning details',bodyHint:'WARNING: Describe the hazard and the required safe action...',specific:[['severity','Severity','select','Information|Caution|Warning|Danger'],['hazard','Hazard / risk','text'],['effective_until','Valid until','date'],['contact','Contact for assistance','text']]},
    requisition:{title:'Requisition',prompt:'Request supplies, equipment or services. State quantities, business need, priority and approval details; submission does not itself authorize spending.',recipient:'Approving officer / department',subject:'Requisition title',body:'Items or services requested and justification',bodyHint:'List each item/service, quantity, specifications and why it is required...',specific:[['requisition_number','Requisition number','text'],['requesting_department','Requesting department / ward','text'],['priority','Priority','select','Routine|Urgent|Emergency'],['required_date','Required by date','date'],['estimated_cost','Estimated cost','number'],['budget_code','Budget / vote code','text'],['supplier_preference','Preferred supplier (optional)','text'],['approved_by','Approved by','text']]}
  };
  function safe(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function today(){return new Date().toISOString().slice(0,10)}
  function read(key){try{const x=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(x)?x:[]}catch(e){return []}}
  function write(key,data){try{localStorage.setItem(key,JSON.stringify(data));return true}catch(e){alert('Could not save: browser storage may be full or disabled.');return false}}
  function makeSpecific(type){const host=$('hmsOfficeSpecificFields'),d=officeDefs[type];host.innerHTML='';if(!d)return;d.specific.forEach(f=>{const wrap=document.createElement('label');wrap.innerHTML=safe(f[1]);let el;if(f[2]==='select'){el=document.createElement('select');f[3].split('|').forEach(opt=>{const o=document.createElement('option');o.value=opt;o.textContent=opt;el.appendChild(o)})}else if(f[2]==='textarea'){el=document.createElement('textarea');el.rows=3}else{el=document.createElement('input');el.type=f[2]}el.name='specific_'+f[0];el.dataset.officeSpecific=f[0];wrap.appendChild(el);host.appendChild(wrap)})}
  function configureOfficeForm(type,d){
    const setLabel=(id,text)=>{const el=$(id);if(el&&el.firstChild)el.firstChild.textContent=text};
    const recipient=$('hmsOfficeRecipient');
    const layout={
      statement:{to:'Receiving authority / audience',bodyRows:11,actions:'Declaration / concluding statement'},letter:{to:'Recipient name and postal address',toRows:3,bodyRows:12,signature:true,actions:false},memo:{to:'To / recipients',bodyRows:8,actions:'Action required',signature:false},circular:{to:'Distribution / audience',bodyRows:9,actions:'Required action / response'},report:{to:'Submitted to',bodyRows:12,actions:'Recommendations / conclusion'},speech:{to:'Audience / occasion',bodyRows:15,actions:false,signature:false,attachments:false},minutes:{to:'Committee / group',bodyRows:10,actions:'Resolutions / action items'},evaluation:{to:'Evaluator / recipient',bodyRows:11,actions:'Recommendations / conclusion'},interview:{to:'Interview purpose / recipient',bodyRows:12,actions:'Outcome / next steps',signature:false},questionnaire:{to:'Target respondents',bodyRows:14,actions:false,signature:false,attachments:false},manual:{to:'Intended users',bodyRows:14,actions:'Safety notes / review actions'},directions:{to:'Person following directions',bodyRows:12,actions:'Accessibility / safety notes',signature:false,attachments:false},campaign:{to:'Target audience',bodyRows:10,actions:'Call to action'},warning:{to:'Persons affected',bodyRows:9,actions:'Precautions / required action'},requisition:{to:'Approving officer / department',bodyRows:10,actions:'Justification / approval conditions'}
    }[type]||{};
    setLabel('hmsOfficeDateWrap','Document date');
    setLabel('hmsOfficeOrganizationWrap','Issuing organization / facility');
    setLabel('hmsOfficeAuthorWrap',type==='memo'?'From / issuing officer':'Prepared by / author');
    setLabel('hmsOfficeRecipientWrap',layout.to||d.recipient);
    if(recipient){recipient.rows=layout.toRows||2;recipient.placeholder=layout.toRows?'Name, title and mailing address':'Person, department, committee or audience';recipient.required=['letter','memo','circular','minutes'].includes(type)}
    $('hmsOfficeBody').rows=layout.bodyRows||9;
    $('hmsOfficeActionsLabel').hidden=layout.actions===false;
    if(layout.actions!==false){setLabel('hmsOfficeActionsLabel',layout.actions||'Actions, recommendations or conclusion');$('hmsOfficeActions').placeholder=layout.actions==='Resolutions / action items'?'Record each decision, responsible person and due date.':'Enter any required follow-up, recommendations or conclusion.'}
    $('hmsOfficeApproverWrap').hidden=layout.signature===false||layout.signature===undefined&&!['letter','statement','minutes','report','evaluation','warning'].includes(type);
    $('hmsOfficeAttachmentsWrap').hidden=layout.attachments===false;
    setLabel('hmsOfficeAttachmentsWrap',['memo','circular'].includes(type)?'Copy to / distribution':'Distribution / attachments');
    $('hmsOfficeAttachments').placeholder=type==='memo'?'Names or departments copied':'List distribution recipients or attachments';
  }
  function pickForm(){const d={};['Number','Date','Organization','Author','Recipient','Subject','Body','Actions','Approver','Attachments'].forEach(k=>{const el=$('hmsOffice'+k),wrap=el?.closest('label');d[k.toLowerCase()]=el&&!wrap?.hidden?el.value:''});d.type=$('hmsOfficeType').value;d.type_title=officeDefs[d.type]?.title||'';d.specific={};document.querySelectorAll('[data-office-specific]').forEach(el=>d.specific[el.dataset.officeSpecific]=el.value);return d}
  function renderOffice(d){
    const specificLabels={meeting_date:'Meeting date',venue:'Venue / platform',chairperson:'Chairperson',secretary:'Minute taker',attendance:'Present / apologies',letter_type:'Letter type',salutation:'Salutation',closing:'Closing',from:'From',cc:'Copy to',deadline:'Action deadline',report_type:'Report type',reporting_period:'Reporting period',location:'Location / department',severity:'Severity',hazard:'Hazard / risk',effective_until:'Valid until',contact:'Contact for assistance'};
    const date=d.date?new Date(d.date+'T00:00:00').toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}):'';
    const type=d.type||'', kind=safe(d.type_title||'Official Document').toUpperCase(), body=safe(d.body||'').replace(/\n/g,'<br>');
    const specifics=Object.entries(d.specific||{}).filter(([k,v])=>String(v||'').trim()&&!(type==='letter'&&['salutation','closing'].includes(k))).map(([k,v])=>`<div><strong>${safe(specificLabels[k]||k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}:</strong> ${safe(v).replace(/\n/g,'<br>')}</div>`).join('');
    const metadata=[d.number?`<div><strong>Reference:</strong> ${safe(d.number)}</div>`:'',date?`<div><strong>Date:</strong> ${safe(date)}</div>`:type==='letter'&&d.date?`<div><strong>Date:</strong> ${safe(d.date)}</div>`:'',d.recipient&&type!=='letter'?`<div><strong>${type==='minutes'?'Committee / group':type==='memo'?'To':'To / Audience'}:</strong> ${safe(d.recipient).replace(/\n/g,'<br>')}</div>`:'',d.author&&type!=='memo'?`<div><strong>Prepared by:</strong> ${safe(d.author)}</div>`:'',specifics].filter(Boolean).join('');
    const meta=metadata?`<section class="office-meta">${metadata}</section>`:'';
    const greeting=type==='letter'?`<p class="office-formal-greeting">${safe(d.specific?.salutation||'Dear Sir / Madam,')}</p>`:'';
    const closing=type==='letter'&&d.specific?.closing?`<p class="office-formal-closing">${safe(d.specific.closing)}</p>`:'';
    const sectionTitle=({report:'Report narrative',minutes:'Discussion and proceedings',evaluation:'Evaluation findings',interview:'Interview questions and responses',questionnaire:'Questions and response options',manual:'Purpose, scope and procedure',directions:'Route and directions',campaign:'Message',warning:'Notice'}[type])||'';
    const actions=d.actions?`<section class="office-formal-section"><h3>${safe(({minutes:'Resolutions and action items',campaign:'Call to action',warning:'Precautions and required action',manual:'Safety notes and review actions'}[type])||'Recommendations / Conclusion')}</h3><p>${safe(d.actions).replace(/\n/g,'<br>')}</p></section>`:'';
    const signatures=['letter','statement','minutes','report','evaluation','warning'].includes(type)||d.approver;
    const sign=signatures?`<footer class="office-signature"><div><strong>${type==='minutes'?'Prepared by / Minute taker':'Prepared by'}</strong><br>${safe(d.author||'')}<br><br>Signature: __________________________</div><div><strong>Approved / Signed by</strong><br>${safe(d.approver||'')}<br><br>Date: ______________________________</div></footer>`:'';
    const attachments=d.attachments?`<section class="office-formal-attachments"><strong>${['memo','circular'].includes(type)?'Copy to / distribution':'Distribution / attachments'}:</strong><br>${safe(d.attachments).replace(/\n/g,'<br>')}</section>`:'';
    return `<article class="hms-office-paper hms-office-formal-paper"><header class="office-formal-header"><div class="office-formal-organization">${safe(d.organization||'MEDICALSAVVY')}</div><div class="office-formal-document-type">${kind}</div><h1>${safe(d.subject||d.type_title||'Official Document')}</h1></header>${meta}${type==='letter'&&d.recipient?`<address class="office-formal-recipient">${safe(d.recipient).replace(/\n/g,'<br>')}</address>`:''}${greeting}${sectionTitle?`<section class="office-formal-section"><h3>${safe(sectionTitle)}</h3><div class="office-body">${body}</div></section>`:`<section class="office-body">${body}</section>`}${closing}${actions}${attachments}${sign}</article>`;
  }
  // Forwarding uses these same functions so a selected Secretariat attachment
  // is shown as the finished Document Store document, not raw JSON content.
  window.hmsSecretariateDocumentFromStore = officeFromDb;
  window.renderHmsSecretariateDocument = renderOffice;
  function currentOfficeValid(){if(!$('hmsOfficeType').value){alert('Choose a document template first.');return false}if(!$('hmsOfficeForm').reportValidity())return false;return true}
  function showOfficePreview(d){$('hmsOfficePreview').innerHTML=renderOffice(d);$('hmsOfficePreviewPanel').hidden=false;$('hmsOfficePreviewPanel').scrollIntoView({behavior:'smooth',block:'start'})}
  function printHtml(html,kind){let mount=document.getElementById(kind==='gc'?'hmsGcPrintMount':'hmsOfficePrintMount');if(!mount){mount=document.createElement('div');mount.id=kind==='gc'?'hmsGcPrintMount':'hmsOfficePrintMount';document.body.appendChild(mount)}mount.innerHTML=html;document.body.classList.add(kind==='gc'?'hms-gc-printing':'hms-office-printing');const cleanup=()=>{document.body.classList.remove('hms-office-printing','hms-gc-printing');mount.innerHTML='';window.removeEventListener('afterprint',cleanup)};window.addEventListener('afterprint',cleanup);window.print();setTimeout(cleanup,1500)}
  async function refreshOfficeStore(){
    const list=$('hmsOfficeStoreList'),count=$('hmsOfficeStoreCount');
    if(!list||!count)return;
    list.innerHTML='<div class="hms-office-bizdoc-empty">Loading documents from the database…</div>';
    try{await loadOfficeDbDocs();}catch(err){count.textContent='Documents unavailable';list.innerHTML='<div class="hms-office-bizdoc-empty">Could not load documents from the database: '+safe(err.message)+'<br>Check that you are logged in with Secretariate access and that the Flask API is running.</div>';console.error('Secretariate Document Store load failed:',err);return;}
    const query=(($('hmsOfficeSearch')&&$('hmsOfficeSearch').value)||'').trim().toLowerCase();
    const typeFilter=($('hmsOfficeFilter')&&$('hmsOfficeFilter').value)||'';
    const from=($('hmsOfficeDateFrom')&&$('hmsOfficeDateFrom').value)||'';const to=($('hmsOfficeDateTo')&&$('hmsOfficeDateTo').value)||'';
    const month=($('hmsOfficeMonth')&&$('hmsOfficeMonth').value)||'';const year=(($('hmsOfficeYear')&&$('hmsOfficeYear').value)||'').trim();
    const allDocs=officeDbDocs.slice().sort((a,b)=>String(b.date||b.saved_at||'').slice(0,10).localeCompare(String(a.date||a.saved_at||'').slice(0,10))||String(b.saved_at||'').localeCompare(String(a.saved_at||'')));
    const docs=allDocs.filter(d=>{const day=String(d.date||d.saved_at||'').slice(0,10);const docType=String(d.type||'');return (!typeFilter||docType===typeFilter||d.type_title===typeFilter)&&(!query||JSON.stringify(d).toLowerCase().includes(query))&&(!from||day>=from)&&(!to||day<=to)&&(!month||day.slice(5,7)===month)&&(!year||day.slice(0,4)===year);});
    count.textContent=docs.length+' '+(docs.length===1?'document':'documents');
    if(!docs.length){list.innerHTML='<div class="hms-office-bizdoc-empty">'+(allDocs.length?'No documents match the selected filters.':'No documents have been saved yet.')+'</div>';return;}
    const groups={};docs.forEach(d=>{const day=String(d.date||d.saved_at||'').slice(0,10)||'Date not recorded';(groups[day] ||= []).push(d)});
    list.innerHTML=Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(day=>'<section class="hms-office-date-group"><div class="hms-office-date-heading">'+safe(day)+'</div>'+groups[day].map(d=>'<article class="hms-office-document-row"><div class="hms-office-row-main"><div class="hms-office-row-title">'+safe(d.type_title||'Secretariate Document')+' — '+safe(d.number||'No reference')+'</div><div class="hms-office-row-meta">Title / Subject: '+safe(d.subject||d.type_title||'—')+'<br>Recipient: '+safe(d.recipient||'—')+' · Prepared by: '+safe(d.author||'—')+'<br>Document date: '+safe(d.date||'—')+' · Saved: '+safe(String(d.saved_at||'').slice(0,10)||'—')+'</div></div><div class="hms-office-row-actions"><button type="button" class="btn btn-primary" data-office-view="'+safe(d.id)+'">View</button><button type="button" class="btn" data-office-print="'+safe(d.id)+'">Print</button><button type="button" class="btn btn-danger" data-office-delete="'+safe(d.id)+'">Delete</button></div></article>').join('')+'</section>').join('');
  }
  window.refreshHmsOfficeStore = refreshOfficeStore;
  function initOffice(){if(!$('hmsOfficeForm'))return;const filter=$('hmsOfficeFilter');Object.entries(officeDefs).forEach(([key,d])=>{const o=document.createElement('option');o.value=key;o.textContent=d.title;filter.appendChild(o)});$('hmsOfficeDate').value=today();document.querySelectorAll('[data-office-type]').forEach(btn=>btn.addEventListener('click',()=>{const type=btn.dataset.officeType,d=officeDefs[type];$('hmsOfficeType').value=type;$('hmsOfficeFormTitle').textContent=d.title+' Template';$('hmsOfficeSubject').placeholder=d.subject;$('hmsOfficeBodyLabel').firstChild.textContent=d.body;$('hmsOfficeBody').placeholder=d.bodyHint;$('hmsOfficeSubjectWrap').firstChild.textContent=d.subject;makeSpecific(type);configureOfficeForm(type,d);document.querySelectorAll('[data-office-type]').forEach(b=>b.classList.toggle('selected',b===btn));$('hmsOfficePreviewPanel').hidden=true;$('hmsOfficeFormCard').scrollIntoView({behavior:'smooth',block:'start'})}));
    $('hmsOfficePreviewBtn').addEventListener('click',()=>{if(currentOfficeValid())showOfficePreview(pickForm())});$('hmsOfficeSaveBtn').addEventListener('click',async()=>{if(!currentOfficeValid())return;const d=pickForm();const btn=$('hmsOfficeSaveBtn');btn.disabled=true;const oldText=btn.textContent;btn.textContent='Saving to database…';try{const payload={title:d.subject||d.type_title||'Secretariate Document',document_type:d.type||d.type_title||'Document',document_date:d.date||today(),content:JSON.stringify(d)};const saved=await officeApi('/documents',{method:'POST',body:JSON.stringify(payload)});d.number=saved.reference||saved.document?.content?.number||'';showOfficePreview(d);await refreshOfficeStore();alert('Document saved to the database with reference '+d.number+'.');}catch(err){alert('Document was not saved: '+err.message);console.error('Secretariate document save failed:',err);}finally{btn.disabled=false;btn.textContent=oldText;}});$('hmsOfficePrintBtn').addEventListener('click',()=>printHtml($('hmsOfficePreview').innerHTML,'office'));$('hmsOfficeClosePreview').addEventListener('click',()=>$('hmsOfficePreviewPanel').hidden=true);$('hmsOfficeSearch').addEventListener('input',refreshOfficeStore);$('hmsOfficeFilter').addEventListener('change',refreshOfficeStore);$('hmsOfficeDateFrom').addEventListener('change',refreshOfficeStore);$('hmsOfficeDateTo').addEventListener('change',refreshOfficeStore);$('hmsOfficeMonth').addEventListener('change',refreshOfficeStore);$('hmsOfficeYear').addEventListener('input',refreshOfficeStore);$('hmsOfficeClearFilters').addEventListener('click',()=>{$('hmsOfficeSearch').value='';$('hmsOfficeFilter').value='';$('hmsOfficeDateFrom').value='';$('hmsOfficeDateTo').value='';$('hmsOfficeMonth').value='';$('hmsOfficeYear').value='';refreshOfficeStore()});$('hmsOfficeStoreList').addEventListener('click',async e=>{const v=e.target.closest('[data-office-view]'),p=e.target.closest('[data-office-print]'),del=e.target.closest('[data-office-delete]');if(v){const d=officeDbDocs.find(x=>String(x.id)===String(v.dataset.officeView));if(d){$('hmsOfficeStoredView').innerHTML=renderOffice(d);$('hmsOfficeStoredViewPanel').hidden=false;$('hmsOfficeStoredViewPanel').scrollIntoView({behavior:'smooth',block:'start'});}}if(p){const d=officeDbDocs.find(x=>String(x.id)===String(p.dataset.officePrint));if(d)printHtml(renderOffice(d),'office');}if(del&&confirm('Delete this document permanently from the database?')){try{await officeApi('/documents/'+encodeURIComponent(del.dataset.officeDelete),{method:'DELETE'});await refreshOfficeStore();if(!$('hmsOfficeStoredViewPanel').hidden){$('hmsOfficeStoredViewPanel').hidden=true;$('hmsOfficeStoredView').innerHTML='';}}catch(err){alert('Could not delete document: '+err.message);console.error(err);}}});$('hmsOfficeStoredPrintBtn').addEventListener('click',()=>printHtml($('hmsOfficeStoredView').innerHTML,'office'));$('hmsOfficeStoredCloseBtn').addEventListener('click',()=>{$('hmsOfficeStoredViewPanel').hidden=true;$('hmsOfficeStoredView').innerHTML=''});$('hmsOfficeForm').addEventListener('reset',()=>setTimeout(()=>{$('hmsOfficeType').value='';$('hmsOfficeSpecificFields').innerHTML='';$('hmsOfficeFormTitle').textContent='Choose a document template';$('hmsOfficeDate').value=today();document.querySelectorAll('[data-office-type]').forEach(b=>b.classList.remove('selected'));$('hmsOfficePreviewPanel').hidden=true},0));refreshOfficeStore();
  }
  function openHmsStandaloneModule(target,from){const current=document.querySelector('.module-view.active');if(from)window.hmsStandalonePreviousModule=from;else if(current&&current.id!==target)window.hmsStandalonePreviousModule=current.id;document.querySelectorAll('.module-view').forEach(m=>{m.hidden=true;m.classList.remove('active')});const dest=$(target);if(dest){dest.hidden=false;dest.classList.add('active')}document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.module===String(target).replace(/^mod-/,'')));if(target==='mod-guidance-counseling')refreshGc();}
  function hmsOpenGuidanceCounseling(){
    openHmsStandaloneModule('mod-guidance-counseling');
    const heading=document.getElementById('current-module-title');
    if(heading) heading.textContent='Guidance & Counseling';
    if(typeof hmsSetInModule==='function') hmsSetInModule(true);
  }
  window.hmsOpenGuidanceCounseling=hmsOpenGuidanceCounseling;
  window.openHmsStandaloneModule=openHmsStandaloneModule;
  async function gcSave(key,obj){
    const kind=key==='intake'?'Intake':key==='sessions'?'Counseling Session':key==='follow'?'Follow-up':'Resource';
    const reference=String(obj.reference||obj.title||obj.case_label||'').trim();
    const name=String(obj.client_name||obj.case_label||obj.title||reference).trim();
    if(!reference||!name){alert('Please complete the required fields.');return false}
    try{await gcApi('',{method:'POST',body:JSON.stringify({client_reference:reference,client_name:name,record_type:kind,record_date:obj.date||obj.due_date||today(),follow_up_date:obj.next_date||obj.due_date||null,referral_destination:obj.action||obj.details||'',notes:JSON.stringify(obj),outcome:obj.status||obj.outcome||''})});await gcLoadAll();return true}
    catch(err){alert('Record was not saved: '+err.message);console.error(err);return false}
  }
  function formObject(form){const obj={};new FormData(form).forEach((v,k)=>obj[k]=String(v));return obj}
  function gcSetPatient(selectId,referenceId,nameId,patientId){const select=$(selectId);if(select)select.value=patientId||'';const patient=gcPatients.find(p=>String(p.patient_id)===String(patientId))||gcDoctorReferrals.find(p=>String(p.patient_id)===String(patientId));if(patient){$(referenceId).value=patient.patient_id;$(nameId).value=patient.full_name||patient.patient_name||patient.patient_id}}
  function gcPatientStageOptions(stage){
    let rows=[];
    if(stage==='intake')rows=gcDoctorReferrals.filter(r=>String(r.status).toUpperCase()!=='COMPLETED').map(r=>({patient_id:r.patient_id,patient_db_id:r.patient_db_id,full_name:r.patient_name}));
    if(stage==='sessions')rows=gcRows.intake.map(r=>({patient_id:r.patient_id,full_name:r.case_label})).filter(r=>r.patient_id);
    if(stage==='follow')rows=gcRows.sessions.map(r=>({patient_id:r.patient_id,full_name:r.client_name||r.case_label})).filter(r=>r.patient_id);
    const unique=new Map();rows.forEach(r=>{if(r.patient_id&&!unique.has(String(r.patient_id))){const registered=gcPatients.find(p=>String(p.patient_id)===String(r.patient_id));unique.set(String(r.patient_id),{patient_id:r.patient_id,patient_db_id:registered?.id||r.patient_db_id||'',full_name:registered?.full_name||r.full_name||r.patient_id,clinic:registered?.clinic||''})}});
    return [...unique.values()];
  }
  function gcRenderPatientOptions(){[['gcIntakePatientSelect','gcIntakeReference','gcIntakeCaseLabel','intake'],['gcSessionPatientSelect','gcSessionReference','gcSessionClientName','sessions'],['gcFollowPatientSelect','gcFollowReference','gcFollowClientName','follow']].forEach(([sid,rid,nid,stage])=>{const select=$(sid);if(!select)return;const selected=select.value;const patients=gcPatientStageOptions(stage);select.innerHTML='<option value="">Select an eligible patient or enter details below</option>'+patients.map(p=>`<option value="${safe(p.patient_id)}" data-patient-id="${Number(p.patient_db_id)||''}">${safe(p.patient_id)} · ${safe(p.full_name)}${p.clinic?' · '+safe(p.clinic):''}</option>`).join('');if(selected&&patients.some(p=>String(p.patient_id)===selected))select.value=selected;select.onchange=()=>gcSetPatient(sid,rid,nid,select.value)})}
  function gcBuildJourneyRows(){
    const journeys=new Map();
    const get=(key)=>{if(!journeys.has(key))journeys.set(key,{key,patient_id:'',name:'',reference:'',referral:'Not referred',intake:'',session:'',follow:'',stage:'Doctor referral'});return journeys.get(key)};
    gcDoctorReferrals.forEach(r=>{const id=String(r.patient_id||'');if(!id)return;const row=get('patient:'+id);if(row.referral==='Not referred'){row.patient_id=id;row.name=r.patient_name||row.name;row.reference=r.reference||row.reference;row.referral=String(r.status||'Pending');row.stage=row.referral.toUpperCase()==='COMPLETED'?'Completed':row.referral.toUpperCase().includes('PROGRESS')?'Intake & Referrals':'Doctor referral'}});
    [['intake','intake'],['sessions','session'],['follow','follow']].forEach(([key,stage])=>(gcRows[key]||[]).forEach(r=>{const id=String(r.patient_id||'');const ref=String(r.reference||'');const groupKey=id?'patient:'+id:'case:'+ref;if(!id&&!ref)return;const row=get(groupKey);row.patient_id=row.patient_id||id;row.name=row.name||r.client_name||r.case_label||ref;row.reference=row.reference||ref;row[stage]=r.date||r.due_date||r.saved_at?.slice(0,10)||'Saved'}));
    return [...journeys.values()].map(row=>{const followed=!!row.follow;const session=!!row.session;const intake=!!row.intake;if(followed)row.stage=String(row.referral).toUpperCase()==='COMPLETED'?'Completed':'Follow-up recorded';else if(session)row.stage='Follow-up';else if(intake)row.stage='Counseling Sessions';return row}).sort((a,b)=>String(b.follow||b.session||b.intake).localeCompare(String(a.follow||a.session||a.intake)));
  }
  function gcStoreMatches(query,name,patientId,reference){const q=String(query||'').trim().toLocaleLowerCase();if(!q)return true;return [name,patientId,reference].some(value=>String(value||'').toLocaleLowerCase().includes(q))}
  function gcJourneyTypeMatches(row){if(gcStoreTypeFilter==='all')return true;if(gcStoreTypeFilter==='Doctor Referral')return row.referral!=='Not referred';if(gcStoreTypeFilter==='Intake / Referral')return !!row.intake;if(gcStoreTypeFilter==='Counseling Session')return !!row.session;if(gcStoreTypeFilter==='Follow-up')return !!row.follow;return true}
  function gcRecordDetailMarkup(details){
    const entries=Object.entries(details||{});if(!entries.length)return '<p class="hms-office-empty">No additional fields were saved.</p>';
    return '<dl class="hms-gc-record-fields">'+entries.map(([key,value])=>{let display=value;if(display&&typeof display==='object')display=JSON.stringify(display,null,2);if(display===null||display===undefined||display==='')display='—';const label=key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());return `<div><dt>${safe(label)}</dt><dd>${safe(display)}</dd></div>`}).join('')+'</dl>';
  }
  function renderGcStoredRecords(){
    const host=$('gcStoredRecords');if(!host)return;
    const rows=[];
    const titles={intake:'Intake / Referral',sessions:'Counseling Session',follow:'Follow-up',resources:'Guidance Resource'};
    Object.entries(gcRows).filter(([key])=>key!=='resources').forEach(([key,list])=>list.forEach(record=>rows.push({kind:titles[key]||record.record_type||key,name:record.client_name||record.case_label||record.title||record.reference,reference:record.reference,date:record.date||record.due_date||record.saved_at?.slice(0,10),details:{...(record._record_meta||{}),...(record._details||{})},id:record.id})));
    gcDoctorReferrals.forEach(r=>rows.push({kind:'Doctor Referral',name:r.patient_name,reference:r.reference,date:String(r.created_at||'').slice(0,10),details:{patient_id:r.patient_id,referral_reference:r.reference,status:r.status,referral_notes:r.notes||''}}));
    const filteredRows=rows.filter(r=>gcStoreMatches(gcStoreFilter,r.name,r.details?.patient_id||r.details?.client_reference,r.reference)&&(gcStoreTypeFilter==='all'||r.kind===gcStoreTypeFilter));
    filteredRows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    host.innerHTML=filteredRows.length?'<div class="hms-gc-record-grid">'+filteredRows.map(r=>`<article class="hms-gc-record-card"><header><div><span class="hms-gc-record-type">${safe(r.kind)}</span><h3>${safe(r.name||'Record')}</h3><p>${safe(r.reference||'')} ${r.date?'· '+safe(r.date):''}</p></div>${r.id?`<button type="button" class="btn" data-gc-delete="${safe(r.id)}">Delete</button>`:''}</header>${gcRecordDetailMarkup(r.details)}</article>`).join('')+'</div>':'<p class="hms-office-empty">'+(gcStoreFilter||gcStoreTypeFilter!=='all'?'No saved records match these filters.':'No saved records are available yet.')+'</p>';
  }  function renderGcJourneyStore(){
    const host=$('gcJourneyStore');if(!host)return;const rows=gcBuildJourneyRows().filter(r=>gcStoreMatches(gcStoreFilter,r.name,r.patient_id,r.reference)&&gcJourneyTypeMatches(r));
    host.innerHTML=rows.length?'<div class="hms-gc-journey-grid">'+rows.map(r=>`<article class="hms-gc-journey-card"><header><div><h3>${safe(r.name||'Patient')}</h3><p>${safe(r.patient_id||'Manual case')} · Referral ${safe(r.reference||'—')}</p></div><span class="hms-gc-stage-badge">${safe(r.stage)}</span></header><div class="hms-gc-journey-steps"><div><span>Doctor referral</span><strong>${safe(r.referral)}</strong></div><div><span>Intake</span><strong>${safe(r.intake||'Waiting')}</strong></div><div><span>Counseling session</span><strong>${safe(r.session||'Waiting')}</strong></div><div><span>Follow-up</span><strong>${safe(r.follow||'Waiting')}</strong></div></div></article>`).join('')+'</div>':'<p class="hms-office-empty">'+(gcStoreFilter||gcStoreTypeFilter!=='all'?'No patient journeys match these filters.':'No doctor referrals or Guidance &amp; Counseling journey records are available yet.')+'</p>';
    renderGcStoredRecords();
  }  function refreshGc(){
    if(!$('gcCountIntake'))return;gcRenderPatientOptions();
    const intake=gcRows.intake,sessions=gcRows.sessions,follow=gcRows.follow,resources=gcRows.resources;
    const active=gcDoctorReferrals.filter(r=>String(r.status).toUpperCase()!=='COMPLETED');
    $('gcCountIntake').textContent=intake.length+active.length;$('gcCountSessions').textContent=sessions.length;$('gcCountFollowup').textContent=follow.length;
    renderGcJourneyStore();
    const all=[['Active doctor referrals',active.length],['Completed doctor referrals',gcDoctorReferrals.length-active.length],['Intake / referrals',intake.length],['Counseling sessions',sessions.length],['Follow-up actions',follow.length],['Guidance resources',resources.length]];
    $('gcSummaryContent').innerHTML='<table class="hms-workflow-table"><thead><tr><th>Record category</th><th>Saved count</th></tr></thead><tbody>'+all.map(a=>`<tr><td>${safe(a[0])}</td><td>${a[1]}</td></tr>`).join('')+'</tbody></table>';
  }
  window.refreshGuidanceCounseling=()=>gcLoadAll().catch(error=>{
    console.error('Guidance & Counseling refresh failed:',error);
    ['gcJourneyStore','gcStoredRecords'].forEach(id=>{if($(id))$(id).innerHTML='<p class="hms-office-empty">Unable to load saved records: '+safe(error.message)+'</p>'});
  });
  function gcSwitchTab(id){const button=document.querySelector(`#guidance-counseling-tabs button[onclick*="${id}"]`);if(button)switchHmsNestedTab(button,id)}
  function gcPrefillNext(selectId,referenceId,nameId,patientId,reference,name){const patient=gcPatients.find(p=>String(p.patient_id)===String(patientId));const select=$(selectId);if(select){select.value=patient?patient.patient_id:'';select.dispatchEvent(new Event('change',{bubbles:true}))}if(patient){$(referenceId).value=patient.patient_id;$(nameId).value=patient.full_name}else{$(referenceId).value=reference||'';$(nameId).value=name||''}}
  function initGc(){
    if(!$('gcIntakeForm'))return;
    [['gcIntakeForm','intake'],['gcSessionForm','sessions'],['gcFollowForm','follow'],['gcResourceForm','resources']].forEach(([formId,key])=>$(formId).addEventListener('submit',async e=>{
      e.preventDefault();const f=$(formId);if(!f.reportValidity())return;const obj=formObject(f);
      if(key==='intake')obj.patient_id=$('gcIntakePatientSelect').value||'';
      if(key==='sessions')obj.patient_id=$('gcSessionPatientSelect').value||'';
      if(key==='follow')obj.patient_id=$('gcFollowPatientSelect').value||'';
      if(!await gcSave(key,obj))return;
      if(key==='intake'){
        const patientId=obj.patient_id,reference=obj.reference,name=obj.case_label;
        const referral=gcDoctorReferrals.find(r=>String(r.patient_id)===String(patientId)&&String(r.status).toUpperCase()!=='COMPLETED');
        if(referral&&!String(referral.status).toUpperCase().includes('PROGRESS')){try{await gcApi('/referrals/'+encodeURIComponent(referral.id),{method:'PATCH',body:JSON.stringify({status:'In Progress'})});await gcLoadAll()}catch(err){alert('Intake was saved, but the doctor referral could not be updated: '+err.message)}}
        f.reset();gcPrefillNext('gcSessionPatientSelect','gcSessionReference','gcSessionClientName',patientId,reference,name);gcSwitchTab('gc-sessions');
      }else if(key==='sessions'){
        const patientId=obj.patient_id,reference=obj.reference,name=obj.client_name;
        f.reset();gcPrefillNext('gcFollowPatientSelect','gcFollowReference','gcFollowClientName',patientId,reference,name);gcSwitchTab('gc-follow-up');
      }else if(key==='follow'){
        const patientId=obj.patient_id;
        f.reset();
        const openReferral=gcDoctorReferrals.find(r=>String(r.patient_id)===String(patientId)&&String(r.status).toUpperCase().includes('PROGRESS'));
        if(openReferral){try{await gcApi('/referrals/'+encodeURIComponent(openReferral.id),{method:'PATCH',body:JSON.stringify({status:'Completed'})});await gcLoadAll()}catch(err){alert('Follow-up was saved, but referral status could not be updated: '+err.message)}}
        gcSwitchTab('gc-journey-store');
      }else{f.reset()}
      const date=f.querySelector('input[type=date]');if(date)date.value=today();
    }));
    document.querySelectorAll('#mod-guidance-counseling input[type=date]').forEach(el=>{if(!el.value)el.value=today()});
    $('gcGoIntake')?.addEventListener('click',()=>gcSwitchTab('gc-intake-referrals'));$('gcGoSessions')?.addEventListener('click',()=>gcSwitchTab('gc-sessions'));
    $('gcStorePatientFilter')?.addEventListener('input',e=>{gcStoreFilter=e.target.value;renderGcJourneyStore()});
    $('gcStoreTypeFilter')?.addEventListener('change',e=>{gcStoreTypeFilter=e.target.value||'all';renderGcJourneyStore()});
    $('mod-guidance-counseling').addEventListener('click',async e=>{
      const del=e.target.closest('[data-gc-delete]');
      if(del&&confirm('Delete this saved record from the database?')){try{await gcApi('/'+encodeURIComponent(del.dataset.gcDelete),{method:'DELETE'});await gcLoadAll()}catch(err){alert('Could not delete record: '+err.message)}}
    });
    $('gcPrintSummary')?.addEventListener('click',()=>printHtml($('gcSummaryContent').innerHTML,'gc'));
    gcLoadAll().catch(err=>{console.error(err);['gcJourneyStore','gcStoredRecords'].forEach(id=>{if($(id))$(id).innerHTML='<p class="hms-office-empty">Unable to load saved records: '+safe(err.message)+'</p>'})});
  }
  document.addEventListener('DOMContentLoaded',()=>{try{initOffice()}catch(error){console.error('Secretariate document tools could not initialize:',error)}try{initGc()}catch(error){console.error('Guidance & Counseling tools could not initialize:',error)}});
})();

/* ========================================================================
   HOSPITAL ADMINISTRATION: DATABASE-BACKED DISEASE GRAPH + PATIENT JOURNEY
   ACCOUNTS: DATABASE-BACKED FACILITATION FUND DISPENSING REGISTER
   ======================================================================== */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const htmlSafe = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);
  async function apiJson(url, options) {
    const response = await fetch(url, {credentials:'same-origin', cache:'no-store', ...(options||{}), headers:{'Accept':'application/json', ...((options&&options.headers)||{}), ...((options&&options.body)?{'Content-Type':'application/json'}:{})}});
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || data.message || ('Request failed ('+response.status+')'));
    return data;
  }

  async function refreshDiseaseStatistics() {
    const period = byId('hms-disease-period');
    const body = byId('hms-disease-table');
    const summary = byId('hms-disease-summary');
    const canvas = byId('hms-disease-chart');
    if (!period || !body || !canvas) return;
    body.innerHTML = '<tr><td colspan="2">Loading diagnosis statistics…</td></tr>';
    try {
      const data = await apiJson('/api/admin/hospital/disease-statistics?period='+encodeURIComponent(period.value));
      const items = data.items || [];
      body.innerHTML = items.length ? items.map(item=>'<tr><td>'+htmlSafe(item.diagnosis)+'</td><td>'+Number(item.count||0)+'</td></tr>').join('') : '<tr><td colspan="2">No diagnoses were recorded in this period.</td></tr>';
      if (summary) summary.textContent = Number(data.total_diagnoses||0)+' diagnosis record(s) in the selected period.';
      drawDiseaseChart(canvas, items);
    } catch (error) {
      body.innerHTML = '<tr><td colspan="2">'+htmlSafe(error.message)+'</td></tr>';
      if (summary) summary.textContent = 'Unable to load statistics. Check your access and database connection.';
      drawDiseaseChart(canvas, []);
    }
  }
  function drawDiseaseChart(canvas, items) {
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    const width = Math.max(320, canvas.clientWidth || canvas.parentElement.clientWidth || 640);
    const rowHeight = 32, top = 20, left = 150, right = 45;
    const visible = (items||[]).slice(0,12);
    const height = Math.max(240, top + visible.length*rowHeight + 28);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width*ratio); canvas.height = Math.floor(height*ratio);
    canvas.style.width = '100%'; canvas.style.height = height+'px';
    ctx.scale(ratio,ratio); ctx.clearRect(0,0,width,height);
    ctx.font = '12px Segoe UI, sans-serif'; ctx.textBaseline = 'middle';
    if (!visible.length) { ctx.fillStyle='#64748b'; ctx.fillText('No diagnosis data for this period',16,35); return; }
    const max = Math.max(1,...visible.map(x=>Number(x.count)||0));
    const barMax = Math.max(80,width-left-right);
    visible.forEach((item,index)=>{
      const y=top+index*rowHeight+rowHeight/2;
      let label=String(item.diagnosis||'Unspecified');
      if(label.length>22) label=label.slice(0,21)+'…';
      ctx.fillStyle='#334155'; ctx.textAlign='right'; ctx.fillText(label,left-12,y);
      const barWidth=Math.max(2,(Number(item.count)||0)/max*barMax);
      ctx.fillStyle='#2563eb'; ctx.fillRect(left,y-7,barWidth,14);
      ctx.fillStyle='#0f172a'; ctx.textAlign='left'; ctx.fillText(String(Number(item.count)||0),Math.min(width-right+3,left+barWidth+7),y);
    });
  }

  let patientSearchTimer = null;
  async function searchHospitalPatients() {
    const input=byId('hms-patient-file-search'), host=byId('hms-patient-file-matches');
    if(!input||!host)return;
    const query=input.value.trim();
    if(query.length<1){host.innerHTML='<p class="hms-muted">Type at least one character to search patients.</p>';return;}
    host.innerHTML='<p class="hms-muted">Searching…</p>';
    try{
      const data=await apiJson('/api/admin/hospital/patients?q='+encodeURIComponent(query));
      const patients=data.patients||[];
      host.innerHTML=patients.length?patients.map(p=>'<button type="button" class="hms-patient-match" data-hms-patient-id="'+Number(p.id)+'"><strong>'+htmlSafe(p.full_name)+'</strong><span>'+htmlSafe(p.patient_id)+' · '+htmlSafe(p.phone||'No phone')+'</span></button>').join(''):'<p class="hms-muted">No matching active patient found.</p>';
    }catch(error){host.innerHTML='<p class="hms-error">'+htmlSafe(error.message)+'</p>';}
  }
  function renderJourneyDetails(details) {
    if (!details || typeof details !== 'object') return htmlSafe(details || 'No additional details recorded.');
    const entries = Object.entries(details);
    if (!entries.length) return '<span class="hms-muted">No additional details recorded.</span>';
    return '<dl class="hms-journey-fields">' + entries.map(([label,value]) =>
      '<div><dt>' + htmlSafe(label) + '</dt><dd>' + htmlSafe(value == null || value === '' ? 'Not recorded' : value) + '</dd></div>'
    ).join('') + '</dl>';
  }
  const journeyState = { admin: {patient:null, events:[]}, doctor: {patient:null, events:[]} };
  function journeyFilteredEvents(kind) {
    const prefix = kind === 'doctor' ? 'doc-journey-' : 'hms-journey-';
    const period = byId(prefix+'period')?.value || 'all';
    const fromValue = byId(prefix+'from')?.value || '';
    const toValue = byId(prefix+'to')?.value || '';
    const now = new Date(); let start = null, end = null;
    if (period === '7d') start = new Date(now.getTime()-7*86400000);
    else if (period === '30d') start = new Date(now.getTime()-30*86400000);
    else if (period === '3m') { start = new Date(now); start.setMonth(start.getMonth()-3); }
    else if (period === '6m') { start = new Date(now); start.setMonth(start.getMonth()-6); }
    else if (period === '1y') { start = new Date(now); start.setFullYear(start.getFullYear()-1); }
    if (period === 'custom') {
      if (fromValue) start = new Date(fromValue+'T00:00:00');
      if (toValue) end = new Date(toValue+'T23:59:59.999');
    }
    return journeyState[kind].events.filter(e => {
      if (!e.date) return !start && !end;
      const d = new Date(e.date); if (Number.isNaN(d.getTime())) return !start && !end;
      return (!start || d >= start) && (!end || d <= end);
    });
  }
  function renderJourneyContext(kind) {
    const doctor = kind === 'doctor';
    const host = byId(doctor ? 'doc-patient-journey' : 'hms-patient-journey');
    const state = journeyState[kind]; if (!host || !state.patient) return;
    const patient = state.patient, events = journeyFilteredEvents(kind);
    const heading = '<header class="hms-journey-slide-header"><div><span class="hms-journey-eyebrow">PATIENT MEDICAL JOURNEY</span><h3>'+htmlSafe(patient.full_name||'Patient')+'</h3><p>Patient ID: '+htmlSafe(patient.patient_id||'Not recorded')+'</p></div></header>';
    host.classList.add('hms-patient-journey-slides');
    host.innerHTML = '<section class="hms-patient-journey-slide">'+heading+(events.length?'<p class="hms-journey-count">'+events.length+' patient record(s), newest first</p><div class="hms-journey-slide-records">'+events.map((e,index)=>'<article class="hms-patient-document-card hms-journey-record-slide"><div class="hms-journey-record-index">'+(index+1)+'</div><div class="hms-patient-document-heading"><strong>'+htmlSafe(e.category||'Patient record')+'</strong><time>'+htmlSafe(e.date?new Date(e.date).toLocaleString():'Date not recorded')+'</time></div><div class="hms-patient-document-body">'+renderJourneyDetails(e.details)+'</div></article>').join('')+'</div>':'<p class="hms-muted">No patient journey records match this period.</p>')+'</section>';
  }
  function wireJourneyPeriodFilters(kind) {
    const prefix = kind === 'doctor' ? 'doc-journey-' : 'hms-journey-';
    byId(prefix+'apply')?.addEventListener('click',()=>renderJourneyContext(kind));
    byId(prefix+'period')?.addEventListener('change',()=>{ if(byId(prefix+'period').value !== 'custom') renderJourneyContext(kind); });
  }
  window.printPatientJourney = function(kind) {
    const targetId = kind === 'doctor' ? 'doc-patient-journey' : 'hms-patient-journey';
    const target = byId(targetId);
    if (!target || !target.querySelector('.hms-patient-journey-slide')) {
      window.alert('Select a patient and load their file before printing.');
      return;
    }
    document.body.classList.add('hms-patient-journey-printing');
    document.body.dataset.patientJourneyPrintTarget = targetId;
    const cleanup = () => {
      document.body.classList.remove('hms-patient-journey-printing');
      delete document.body.dataset.patientJourneyPrintTarget;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 1800);
  };
  async function loadPatientJourney(patientId) {
    const tbody=byId('hms-patient-journey'), title=byId('hms-patient-journey-title');
    if(!tbody)return;
    tbody.innerHTML='<p class="hms-muted">Loading patient journey…</p>';
    try{
      const data=await apiJson('/api/admin/hospital/patient-journey/'+encodeURIComponent(patientId));
      const patient=data.patient||{};
      if(title)title.textContent=(patient.full_name||'Patient')+' · '+(patient.patient_id||'');
      journeyState.admin.patient=patient;
      journeyState.admin.events=(data.journey||[]).slice().sort((a,b)=>(b.date?new Date(b.date).getTime():0)-(a.date?new Date(a.date).getTime():0));
      renderJourneyContext('admin');
      window.requestAnimationFrame(()=>tbody.scrollIntoView({behavior:'smooth',block:'start'}));
    }catch(error){tbody.innerHTML='<p class="hms-error">'+htmlSafe(error.message)+'</p>';if(title)title.textContent='Unable to load patient journey';window.requestAnimationFrame(()=>tbody.scrollIntoView({behavior:'smooth',block:'start'}));}
  }

  // Doctor's Patient Files is a standalone duplicate of Hospital Administration Patient Files.
  // It intentionally uses the same search and journey APIs/rendering, with unique DOM IDs.
  let doctorPatientSearchTimer = null;
  async function searchDoctorPatients() {
    const input=byId('doc-patient-file-search'), host=byId('doc-patient-file-matches');
    if(!input||!host)return;
    const query=input.value.trim();
    if(query.length<1){host.innerHTML='<p class="hms-muted">Type at least one character to search patients.</p>';return;}
    host.innerHTML='<p class="hms-muted">Searching…</p>';
    try{
      const data=await apiJson('/api/admin/hospital/patients?q='+encodeURIComponent(query));
      const patients=data.patients||[];
      host.innerHTML=patients.length?patients.map(p=>'<button type="button" class="hms-patient-match" data-doctor-hms-patient-id="'+Number(p.id)+'"><strong>'+htmlSafe(p.full_name)+'</strong><span>'+htmlSafe(p.patient_id)+' · '+htmlSafe(p.phone||'No phone')+'</span></button>').join(''):'<p class="hms-muted">No matching active patient found.</p>';
    }catch(error){host.innerHTML='<p class="hms-error">'+htmlSafe(error.message)+'</p>';}
  }
  async function loadDoctorPatientJourney(patientId) {
    const host=byId('doc-patient-journey'), title=byId('doc-patient-journey-title');
    if(!host)return;
    host.innerHTML='<p class="hms-muted">Loading patient journey…</p>';
    try{
      const data=await apiJson('/api/admin/hospital/patient-journey/'+encodeURIComponent(patientId));
      const patient=data.patient||{};
      if(title)title.textContent=(patient.full_name||'Patient')+' · '+(patient.patient_id||'');
      journeyState.doctor.patient=patient;
      journeyState.doctor.events=(data.journey||[]).slice().sort((a,b)=>(b.date?new Date(b.date).getTime():0)-(a.date?new Date(a.date).getTime():0));
      renderJourneyContext('doctor');
      window.requestAnimationFrame(()=>host.scrollIntoView({behavior:'smooth',block:'start'}));
    }catch(error){host.innerHTML='<p class="hms-error">'+htmlSafe(error.message)+'</p>';if(title)title.textContent='Unable to load patient journey';}
  }
  function initDoctorPatientFiles(){
    const input=byId('doc-patient-file-search'), matches=byId('doc-patient-file-matches');
    if(!input||!matches)return;
    wireJourneyPeriodFilters('doctor');
    input.addEventListener('input',()=>{clearTimeout(doctorPatientSearchTimer);doctorPatientSearchTimer=setTimeout(searchDoctorPatients,250);});
    matches.addEventListener('click',e=>{const button=e.target.closest('[data-doctor-hms-patient-id]');if(button)loadDoctorPatientJourney(button.dataset.doctorHmsPatientId);});
  }

  let fundRecords=[];
  async function refreshFundStore(){
    const host=byId('hms-fund-store-documents'); if(!host)return;
    host.innerHTML='<p class="hms-muted">Loading fund documents…</p>';
    try{
      const data=await apiJson('/api/department-communication/accounts-dispensing'); fundRecords=data.documents||[]; renderFundStore();
    }catch(error){host.innerHTML='<p class="hms-error">'+htmlSafe(error.message)+'</p>';}
  }
  function renderFundStore(){
    const host=byId('hms-fund-store-documents'), search=byId('hms-fund-store-search'), total=byId('hms-fund-store-total');
    if(!host)return;
    const q=(search&&search.value||'').trim().toLowerCase();
    const rows=fundRecords.filter(r=>[r.reference,r.recipient,r.purpose,r.approved_by,r.created_by].some(v=>String(v||'').toLowerCase().includes(q)));
    host.innerHTML=rows.length?rows.map(r=>'<article class="hms-fund-document"><header class="hms-fund-document-header"><div><span class="hms-fund-document-label">TEMPLATE-GENERATED DOCUMENT</span><h3>Funds Dispensing Document</h3></div></header><div class="hms-fund-document-reference"><span>Reference</span><strong>'+htmlSafe(r.reference)+'</strong><span>Created</span><strong>'+htmlSafe(r.created_at?new Date(r.created_at).toLocaleString():'—')+'</strong></div><dl class="hms-fund-document-fields"><div><dt>Recipient / payee</dt><dd>'+htmlSafe(r.recipient)+'</dd></div><div><dt>Amount</dt><dd class="hms-fund-document-amount">'+htmlSafe(money(r.amount))+'</dd></div><div class="hms-fund-document-wide"><dt>Purpose / justification</dt><dd>'+htmlSafe(r.purpose)+'</dd></div><div><dt>Payment method</dt><dd>'+htmlSafe(r.payment_method||'—')+'</dd></div><div><dt>Approved by</dt><dd>'+htmlSafe(r.approved_by||'—')+'</dd></div><div><dt>Prepared by</dt><dd>'+htmlSafe(r.created_by||'—')+'</dd></div><div><dt>Notes</dt><dd>'+htmlSafe(r.notes||'—')+'</dd></div></dl><footer class="hms-fund-document-actions"><a class="btn btn-primary" href="'+htmlSafe(r.download_url)+'">Open / print document</a></footer></article>').join(''):'<p class="hms-muted">No template-generated dispensing documents found.</p>';
    if(total)total.textContent=rows.length+' document(s) from the dispensing template.';
  }
  let adminStockItems=[];
  function adminStockComparison(item){
    const qty=Math.max(0,Number(item.quantity)||0),reorder=Math.max(0,Number(item.reorder_level)||0),method=String(item.valuation_method||'').trim().toLowerCase(),tablet=method==='strips / boxes'&&String(item.drug_type||'').trim().toLowerCase()==='tablets'&&Number(item.strips_per_box)>0;
    let currentValue=qty,reorderValue=reorder,currentText='',reorderText='',unit=({bottles:'bottle',tubes:'tube',pieces:'piece',boxes:'box',packs:'pack',units:'unit'})[method]||'';
    if(tablet){const perBox=Number(item.strips_per_box),loose=Math.max(0,Number(item.loose_strips)||0),remainingStrips=qty*perBox+loose;currentValue=remainingStrips;reorderValue=reorder*perBox;currentText=`${qty} box${qty===1?'':'es'} + ${loose} strip${loose===1?'':'s'} (${remainingStrips} strips)`;reorderText=`${reorder} box${reorder===1?'':'es'} (${reorderValue} strips)`;unit='strips';}
    else{currentText=`${qty} ${unit||'quantity'}`;reorderText=`${reorder} ${unit||'quantity'}`;}
    const valid=!(method==='strips / boxes'&&!tablet)&&Boolean(unit||tablet);
    const pct=valid&&reorderValue>0?Math.round(currentValue/reorderValue*100):null;
    return{currentValue,reorderValue,currentText,reorderText,pct,low:pct!==null&&currentValue<=reorderValue,valid};
  }
  function renderSelectedAdminStock(){
    const select=byId('admin-stock-item-select'),host=byId('admin-stock-gauges');if(!select||!host)return;
    const item=adminStockItems.find(row=>String(row.id)===String(select.value));if(!item){host.innerHTML=adminStockItems.length?'<p class="hms-muted">Select an inventory item.</p>':'<p class="hms-muted">No inventory items recorded.</p>';return;}
    const stock=adminStockComparison(item);if(!stock.valid){host.innerHTML='<p class="hms-muted">This item has no valid dispensing unit or tablet conversion. Its stock gauge is unavailable until the inventory record is corrected.</p>';return;}
    const pct=stock.pct,width=pct===null?0:Math.min(100,pct);
    host.innerHTML=`<div class="hms-admin-stock-label"><strong>${htmlSafe(item.name||'Inventory item')}</strong></div><div class="hms-admin-stock-readings"><div class="hms-admin-stock-reading"><small>On hand</small><strong>${stock.currentText}</strong></div><div class="hms-admin-stock-reading"><small>Reorder level</small><strong>${stock.reorderText}</strong></div></div>${pct===null?'<p class="hms-muted">Add a reorder level to calculate the stock fraction.</p>':`<div class="hms-admin-stock-percent">${pct}% of reorder level${stock.low?' · At or below reorder level':''}</div><div class="hms-admin-stock-track" role="meter" aria-label="${htmlSafe(item.name)} stock compared with reorder level" aria-valuemin="0" aria-valuenow="${stock.currentValue}" aria-valuemax="${stock.reorderValue}"><span style="width:${width}%" class="${stock.low?'is-low':''}"></span></div>`}`;
  }
  function adminStockIsLow(item){
    const quantity=Number(item.quantity||0),reorder=Number(item.reorder_level||0);
    if(item.category==='Drug Stock'&&String(item.drug_type||'').toLowerCase()==='tablets'&&Number(item.strips_per_box)>0){
      return quantity*Number(item.strips_per_box)+Number(item.loose_strips||0)<=reorder*Number(item.strips_per_box);
    }
    return quantity<=reorder;
  }
  function renderAdminStockLedger(){
    const filter=byId('admin-stock-status-filter')?.value||'all';
    const days=Math.max(1,Number(byId('admin-stock-expiry-days')?.value||90));
    const today=new Date();today.setHours(0,0,0,0);
    const getExpiringBatches=(item)=>{
      const batches=Array.isArray(item.batches)&&item.batches.length?item.batches:[{batch_number:1,quantity_remaining:item.quantity,expiry_date:item.expiry_date,legacy:true}];
      return batches.map(batch=>{const expiry=batch.expiry_date?new Date(batch.expiry_date+'T00:00:00'):null;const delta=expiry?Math.ceil((expiry-today)/86400000):null;return {...batch,days_to_expiry:delta};}).filter(batch=>batch.expiry_date&&batch.days_to_expiry>=0&&batch.days_to_expiry<=days&&Number(batch.quantity_remaining||0)>0);
    };
    const filtered=adminStockItems.filter(item=>{
      if(filter==='low')return adminStockIsLow(item);
      if(filter==='expiring')return getExpiringBatches(item).length>0;
      return true;
    });
    const tables={
      'Drug Stock':byId('admin-stock-drug-table'),
      'Medical Supplies':byId('admin-stock-supplies-table'),
      'Equipment':byId('admin-stock-equipment-table')
    };
    Object.entries(tables).forEach(([category,table])=>{
      if(!table)return;
      const rows=filtered.filter(item=>item.category===category);
      table.innerHTML=rows.length?rows.map(item=>{
        const stock=adminStockComparison(item);
        const quantity=Number(item.quantity||0),reorder=Number(item.reorder_level||0);
        let stockDisplay=String(quantity),reorderDisplay=String(reorder),low=adminStockIsLow(item);
        if(category==='Drug Stock'&&String(item.drug_type||'').toLowerCase()==='tablets'&&Number(item.strips_per_box)>0){
          const perBox=Number(item.strips_per_box),loose=Number(item.loose_strips||0),total=quantity*perBox+loose;
          low=total<=reorder*perBox;
          stockDisplay=`${quantity} Box${quantity!==1?'es':''} + ${loose} Strip${loose!==1?'s':''} = ${total} Strips`;
          reorderDisplay=`${reorder} Box${reorder!==1?'es':''} (${reorder*perBox} Strips)`;
        }
        const name=htmlSafe(item.item_name||item.name||'');
        const expiringBatches=getExpiringBatches(item);
        const expiryNotice=expiringBatches.length?`<div class="hms-stock-batch-notice" role="note"><strong>Expiry notice:</strong> ${expiringBatches.map(batch=>`Batch ${Number(batch.batch_number)||1} — ${htmlSafe(batch.expiry_date)} (${Number(batch.quantity_remaining||0)} remaining${batch.days_to_expiry===0?', expires today':` · ${batch.days_to_expiry} day(s) left`})`).join('; ')}</div>`:'';
        return `<tr${low?' class="hms-stock-low-row"':''}><td>${htmlSafe(item.item_code||'')}</td><td>${name}${item.drug_type?`<br><small>${htmlSafe(item.drug_type)}</small>`:''}${expiryNotice}</td><td>${htmlSafe(item.valuation_method||'')}</td><td><strong>${htmlSafe(stockDisplay)}</strong>${low?' <span class="badge badge-p1">Low</span>':''}</td><td>${htmlSafe(reorderDisplay)}</td><td>${htmlSafe(item.supplier||'N/A')}</td></tr>`;
      }).join(''):'<tr><td colspan="6" style="text-align:center;">No stock items match this filter.</td></tr>';
    });
    const summary=byId('admin-stock-filter-summary');
    if(summary)summary.textContent=`Showing ${filtered.length} of ${adminStockItems.length} stock item(s)${filter==='low'?' at/about reorder level':filter==='expiring'?` expiring within ${days} day(s)`:''}.`;
  }
  async function refreshAdminOperationsSummary(){
    if(!byId('admin-funds-used-today')&&!byId('admin-stock-drug-table')&&!byId('stat-guidance-workload'))return;
    try{
      const data=await apiJson('/api/admin/hospital/operations-summary');
      if(byId('admin-funds-used-today'))byId('admin-funds-used-today').textContent=money(data.funds_used_today)+' · '+data.funds_date;
      if(byId('stat-guidance-workload'))byId('stat-guidance-workload').textContent=Number(data.guidance_workload||0)+' Pending';
      if(byId('admin-stock-drug-table')){adminStockItems=data.stock||[];renderAdminStockLedger();}
    }catch(error){
      if(byId('admin-funds-used-today'))byId('admin-funds-used-today').textContent='Unable to load';
      if(byId('stat-guidance-workload'))byId('stat-guidance-workload').textContent='Unavailable';
      ['admin-stock-drug-table','admin-stock-supplies-table','admin-stock-equipment-table'].forEach(id=>{const table=byId(id);if(table)table.innerHTML='<tr><td colspan="6">Unable to load stock ledger.</td></tr>';});
      if(byId('admin-stock-filter-summary'))byId('admin-stock-filter-summary').textContent='Stock data could not be loaded.';
    }
  }
  // Used by the Hospital Administration tab switcher when Stock & Expiry opens.
  window.refreshAdminOperationsSummary = refreshAdminOperationsSummary;
  async function initAdminAndAccountsWindows(){
    await hmsWaitForAuthRole();
    byId('admin-stock-status-filter')?.addEventListener('change',renderAdminStockLedger);byId('admin-stock-expiry-days')?.addEventListener('input',renderAdminStockLedger);
    if(byId('admin-stock-drug-table')||byId('stat-guidance-workload')){refreshAdminOperationsSummary();window.setInterval(()=>{if(document.visibilityState!=='hidden')refreshAdminOperationsSummary();},30000);}
    if(byId('hms-disease-period')){
      byId('hms-disease-refresh')?.addEventListener('click',refreshDiseaseStatistics);
      byId('hms-disease-period').addEventListener('change',refreshDiseaseStatistics);
      byId('hospital-admin-disease-statistics')?.addEventListener('click',()=>refreshDiseaseStatistics());
      refreshDiseaseStatistics();
      window.addEventListener('resize',()=>{if(byId('hospital-admin-disease-statistics')?.classList.contains('active'))refreshDiseaseStatistics();});
      // Poll the database so diagnoses added by any workstation appear without a manual reload.
      window.setInterval(()=>{if(document.visibilityState!=='hidden')refreshDiseaseStatistics();},30000);
    }
    if(byId('hms-patient-file-search')){
      wireJourneyPeriodFilters('admin');
      byId('hms-patient-file-search').addEventListener('input',()=>{clearTimeout(patientSearchTimer);patientSearchTimer=setTimeout(searchHospitalPatients,250);});
      byId('hms-patient-file-matches')?.addEventListener('click',e=>{const button=e.target.closest('[data-hms-patient-id]');if(button)loadPatientJourney(button.dataset.hmsPatientId);});
    }
    const form=byId('hms-admin-fund-request-form');
    if(form){const date=form.querySelector('[name="fund_date"]');if(date&&!date.value)date.value=new Date().toISOString().slice(0,10);
      form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;const status=byId('hms-admin-fund-status'),button=form.querySelector('button[type="submit"]');const payload=Object.fromEntries(new FormData(form).entries());payload.amount=Number(payload.amount);if(status)status.textContent='Confirming request…';if(button)button.disabled=true;try{const saved=await apiJson('/api/admin/facilitation-funds',{method:'POST',body:JSON.stringify(payload)});if(status)status.textContent='Request confirmed and sent to Finance. Reference: '+saved.reference;const keepDate=date&&date.value;form.reset();if(date)date.value=keepDate||new Date().toISOString().slice(0,10);}catch(error){if(status)status.textContent='Request not saved: '+error.message;}finally{if(button)button.disabled=false;}});
    }
    if(byId('hms-fund-store-documents')&&hmsRoleMayCall('/api/department-communication/accounts-dispensing')){byId('hms-fund-store-search')?.addEventListener('input',renderFundStore);refreshFundStore();}
    document.addEventListener('hms:diagnosis-saved',refreshDiseaseStatistics);
  }
  window.refreshHmsDiseaseStatistics=refreshDiseaseStatistics;
  window.refreshHmsPatientJourney=loadPatientJourney;
  window.refreshHmsFundDispensingRecords=refreshFundStore;
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initAdminAndAccountsWindows,{once:true});
    document.addEventListener('DOMContentLoaded',initDoctorPatientFiles,{once:true});
  }else{initAdminAndAccountsWindows();initDoctorPatientFiles();}
})();


/* Login/setup workflow consolidated from login.html and guarded to that page. */
if (document.getElementById("hms-login-form")) {
(function () {

    'use strict';

    // ========================================================
    // ELEMENTS
    // ========================================================

    const loginForm =
        document.getElementById(
            'hms-login-form'
        );

    const setupForm =
        document.getElementById(
            'initial-admin-form'
        );

    const loginButton =
        document.getElementById(
            'login-button'
        );

    const setupButton =
        document.getElementById(
            'setup-button'
        );

    const errorElement =
        document.getElementById(
            'login-error'
        );

    const successElement =
        document.getElementById(
            'login-success'
        );

    const setupBadge =
        document.getElementById(
            'setup-badge'
        );

    const subtitle =
        document.getElementById(
            'login-subtitle'
        );

    const departmentOverlay = document.getElementById('department-login-overlay');
    const departmentForm = document.getElementById('department-login-form');
    const departmentSelect = document.getElementById('login-department');
    const departmentGroup = document.getElementById('login-department-group');
    const departmentRoleLabel = document.getElementById('department-login-role');
    const departmentPanelTitle = document.getElementById('department-login-title');
    const departmentPanelCopy = document.querySelector('.department-login-copy');
    const departmentButton = document.getElementById('department-login-button');
    const departmentClose = document.getElementById('department-login-close');
    const departmentError = document.getElementById('department-login-error');
    let selectedLoginRole = null;
    let loginPanelStep = null;

    // ========================================================
    // MESSAGE HELPERS
    // ========================================================

    function showError(message) {

        errorElement.textContent =
            message;

        errorElement.style.display =
            'block';

        successElement.style.display =
            'none';
    }

    function showSuccess(message) {

        successElement.textContent =
            message;

        successElement.style.display =
            'block';

        errorElement.style.display =
            'none';
    }

    function clearMessages() {

        errorElement.textContent = '';

        errorElement.style.display =
            'none';

        successElement.textContent = '';

        successElement.style.display =
            'none';
    }

    // ========================================================
    // SHOW INITIAL SETUP
    // ========================================================

    function showInitialSetup() {

        loginForm.classList.add(
            'hidden'
        );

        setupForm.classList.remove(
            'hidden'
        );

        setupBadge.classList.remove(
            'hidden'
        );

        subtitle.textContent =
            'Create the first System Admin account';

        clearMessages();

    }

    // ========================================================
    // SHOW NORMAL LOGIN
    // ========================================================

    function showNormalLogin() {

        setupForm.classList.add(
            'hidden'
        );

        loginForm.classList.remove(
            'hidden'
        );

        setupBadge.classList.add(
            'hidden'
        );

        subtitle.textContent =
            'Sign in to continue';

        clearMessages();

    }

    // ========================================================
    // CHECK SYSTEM SETUP STATUS
    // ========================================================

    async function checkSetupStatus() {

        try {

            const response =
                await fetch(
                    '/api/auth/setup-status',
                    {
                        method: 'GET',
                        credentials: 'same-origin'
                    }
                );

            const data =
                await response.json();

            if (
                response.ok &&
                data.success &&
                data.setup_required
            ) {

                showInitialSetup();

                return;
            }

            showNormalLogin();

        } catch (error) {

            console.error(
                'HMS setup status error:',
                error
            );

            showError(
                'Unable to connect to the HMS server.'
            );

        }

    }

    // ========================================================
    // INITIAL ADMIN CREATION
    // ========================================================

    setupForm.addEventListener(
        'submit',
        async function (event) {

            event.preventDefault();

            clearMessages();

            const username =
                document.getElementById(
                    'setup-username'
                ).value.trim();

            const password =
                document.getElementById(
                    'setup-password'
                ).value;

            const confirmPassword =
                document.getElementById(
                    'setup-confirm-password'
                ).value;

            if (
                !username ||
                !password ||
                !confirmPassword
            ) {

                showError(
                    'Please complete all fields.'
                );

                return;
            }

            if (password.length < 6) {

                showError(
                    'Password must contain at least 6 characters.'
                );

                return;
            }

            if (
                password !==
                confirmPassword
            ) {

                showError(
                    'Passwords do not match.'
                );

                return;
            }

            setupButton.disabled = true;

            setupButton.textContent =
                'Creating System Admin...';

            try {

                const response =
                    await fetch(
                        '/api/admin/initial-admin',
                        {
                            method: 'POST',

                            headers: {
                                'Content-Type':
                                    'application/json'
                            },

                            credentials:
                                'same-origin',

                            body: JSON.stringify({

                                username:
                                    username,

                                password:
                                    password,

                                confirm_password:
                                    confirmPassword

                            })
                        }
                    );

                const data =
                    await response.json();

                if (!response.ok) {

                    showError(
                        data.message ||
                        data.error ||
                        'Unable to create System Admin.'
                    );

                    return;
                }

                showSuccess(
                    'System Admin created successfully. Opening HMS...'
                );

                // First Admin is automatically
                // logged in by Flask.

                setTimeout(
                    function () {

                        window.location.replace(
                            '/hms'
                        );

                    },
                    700
                );

            } catch (error) {

                console.error(
                    'Initial Administrator setup error:',
                    error
                );

                showError(
                    'Unable to connect to the HMS server.'
                );

            } finally {

                setupButton.disabled =
                    false;

                setupButton.textContent =
                    'Create System Admin';

            }

        }
    );

    // ========================================================
    // NORMAL LOGIN
    // ========================================================

    async function submitCredentials(departmentId = null, roleChoice = selectedLoginRole) {
        clearMessages();
        if (departmentError) {
            departmentError.hidden = true;
            departmentError.textContent = '';
        }
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        if (!username || !password) {
            showError('Enter your username and password.');
            return;
        }

        const panelStep = Boolean(departmentId || roleChoice);
        const button = panelStep ? departmentButton : loginButton;
        if (button) button.disabled = true;
        if (departmentId && departmentButton) departmentButton.textContent = 'Opening workspace…';
        else loginButton.textContent = 'Checking account…';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                credentials: 'same-origin',
                body: JSON.stringify({
                    username,
                    password,
                    ...(roleChoice ? {selected_role: roleChoice} : {}),
                    ...(departmentId ? {department_id: departmentId} : {})
                })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                const message = data.error || data.message || 'Login failed.';
                if (panelStep && departmentError) {
                    departmentError.textContent = message;
                    departmentError.hidden = false;
                } else {
                    showError(message);
                }
                return;
            }

            if (data.requires_department) {
                selectedLoginRole = data.user?.role || roleChoice || null;
                loginPanelStep = 'department';
                departmentGroup.hidden = false;
                departmentSelect.required = true;
                departmentSelect.innerHTML = '<option value="">Choose a department</option>';
                (data.departments || []).forEach(department => {
                    const option = document.createElement('option');
                    option.value = String(department.id);
                    option.textContent = department.name;
                    departmentSelect.appendChild(option);
                });
                departmentRoleLabel.textContent = `Signed in as ${String(data.user?.role || 'staff').replaceAll('_', ' ')}`;
                departmentPanelTitle.textContent = 'Choose your department';
                departmentPanelCopy.textContent = 'Select the department you are heading to for this session.';
                departmentOverlay.hidden = false;
                departmentSelect.focus();
                return;
            }

            departmentOverlay.hidden = true;
            showSuccess('Login successful. Opening HMS...');
            setTimeout(() => window.location.replace('/hms'), 400);
        } catch (error) {
            console.error('HMS login error:', error);
            if (panelStep && departmentError) {
                departmentError.textContent = 'Unable to connect to the HMS server.';
                departmentError.hidden = false;
            } else {
                showError('Unable to connect to the HMS server.');
            }
        } finally {
            if (button) button.disabled = false;
            if (departmentButton) departmentButton.textContent = 'Continue to workspace';
            if (!departmentId) loginButton.textContent = 'Login';
        }
    }

    loginForm.addEventListener('submit', event => {
        event.preventDefault();
        submitCredentials();
    });

    departmentForm?.addEventListener('submit', event => {
        event.preventDefault();
        if (!departmentSelect.value) {
            departmentSelect.focus();
            return;
        }
        submitCredentials(departmentSelect.value);
    });

    departmentClose?.addEventListener('click', () => {
        departmentOverlay.hidden = true;
        departmentSelect.value = '';
        departmentGroup.hidden = true;
        departmentSelect.required = false;
        selectedLoginRole = null;
        loginPanelStep = null;
    });

    departmentOverlay?.addEventListener('click', event => {
        if (event.target === departmentOverlay) departmentClose.click();
    });

    // ========================================================
    // START
    // ========================================================

    checkSetupStatus();

})();
}


/* Search inpatient care cards by patient name or patient ID without hiding the database-backed care history. */
(function(){
  const input=document.getElementById('nurse-inpatient-search');
  const container=document.getElementById('nurse-inpatient-list');
  if(!input||!container)return;
  function apply(){
    const q=input.value.trim().toLowerCase();
    container.querySelectorAll('[data-nurse-patient-search]').forEach(card=>{
      const value=(card.getAttribute('data-nurse-patient-search')||'')+' '+(card.textContent||'').toLowerCase();
      card.hidden=!!q&&!value.includes(q);
    });
  }
  input.addEventListener('input',apply);
  new MutationObserver(apply).observe(container,{childList:true,subtree:true});
})();

/* Doctor nursing rounds: browse current inpatient patients without routing them into the consultation queue. */
(function(){
  const $=id=>document.getElementById(id);
  let patients=[];
  const roundPatientLabel=p=>`${p.full_name} · ${p.patient_id} · Bed ${p.bed_number}`;
  const selectedRoundPatientId=()=>{
    const value=$('doc-nursing-round-patient')?.value||'';
    const patient=patients.find(p=>roundPatientLabel(p)===value);
    return patient?String(patient.id):'';
  };
  function clearRoundPanels(message='Select an under-care patient to view these records.'){
    for(const id of ['doc-round-panel-reports','doc-round-panel-sessions','doc-round-comments-list']){const host=$(id);if(host)host.innerHTML='<p class="hms-muted">'+escapeHTML(message)+'</p>';}
  }
  async function loadRoundsPatients(keepSelection=true){
    const role = await hmsWaitForAuthRole();
    const input=$('doc-nursing-round-patient'), list=$('doc-nursing-round-patients'); if(!input||!list)return;
    if (!hmsRoleMayCall('/api/doctor/nursing-rounds/patients')) {
      input.placeholder='Nursing rounds are not assigned to this account';
      clearRoundPanels('Nursing rounds are not assigned to this account.');
      return;
    }
    const selected=keepSelection?selectedRoundPatientId():'';
    input.placeholder='Loading under-care patients…';
    try{
      const response=await fetch('/api/doctor/nursing-rounds/patients',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.success)throw new Error(data.error||'Unable to load under-care patients.');
      patients=data.patients||[];
      list.innerHTML=patients.map(p=>'<option value="'+escapeHTML(roundPatientLabel(p))+'" data-patient-id="'+Number(p.id)+'"></option>').join('');
      input.placeholder=patients.length?'Type a patient name or ID…':'No patients currently under care';
      const selectedPatient=selected?patients.find(p=>String(p.id)===selected):null;
      input.value=selectedPatient?roundPatientLabel(selectedPatient):'';
      const patientId=selectedRoundPatientId();
      if(patientId)await loadRoundsPatient(patientId);else clearRoundPanels(patients.length?'Select an under-care patient to view these records.':'No under-care patients are assigned to this department.');
    }catch(error){input.placeholder='Unable to load under-care patients';clearRoundPanels(error.message);}
  }
  async function loadRoundsPatient(patientId){
    const reportsHost=$('doc-round-panel-reports'), sessionsHost=$('doc-round-panel-sessions'), commentsHost=$('doc-round-comments-list');
    if(!reportsHost||!sessionsHost||!commentsHost||!patientId)return;
    reportsHost.innerHTML='<p class="hms-muted">Loading follow-up reports…</p>';
    sessionsHost.innerHTML='<p class="hms-muted">Loading nursing sessions…</p>';
    commentsHost.innerHTML='<p class="hms-muted">Loading rounds comments…</p>';
    try{
      const response=await fetch('/api/doctor/nursing-rounds/patient/'+encodeURIComponent(patientId),{credentials:'same-origin',cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.success)throw new Error(data.error||'Unable to load patient nursing history.');
      const sessions=data.nursing_sessions||[], reports=data.follow_up_reports||[], notes=data.round_notes||[];
      const orderedReports=reports.slice().sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
      const reportHistory=orderedReports.map((r,index)=>'<article class="doc-round-entry doc-round-report-combo"><div><strong>Report exchange '+(index+1)+' · '+escapeHTML(r.status||'Follow-up report')+'</strong><time>'+escapeHTML(r.created_at?new Date(r.created_at).toLocaleString():'Date not recorded')+'</time></div>'+
        (r.prior_doctor_instructions?'<div class="doc-round-history-block doc-round-prior-instructions"><strong>Doctor Instructions</strong><p>'+escapeHTML(r.prior_doctor_instructions)+'</p></div>':'')+
        '<div class="doc-round-history-block"><strong>Nurse Report</strong><p>'+escapeHTML(r.report||'No report details recorded.')+'</p></div>'+
        '<div class="doc-round-history-block"><strong>Doctor Response</strong><p>'+escapeHTML(r.doctor_response|| (r.status==='PENDING'?'Awaiting doctor response.':'No response recorded.'))+'</p></div></article>').join('');
      const pendingReports=orderedReports.filter(r=>r.status==='PENDING');
      const newInputs=pendingReports.map(r=>'<div class="doc-round-action-fields"><h5>New response for report '+Number(r.id)+'</h5><div id="doctor-review-date-wrap-'+Number(r.id)+'"><label for="doctor-review-date-'+Number(r.id)+'">Next review date (required to keep patient)</label><input type="date" id="doctor-review-date-'+Number(r.id)+'" value="'+escapeHTML(r.review_date||'')+'"></div><label for="doctor-review-ack-'+Number(r.id)+'">New instructions or discharge authorization</label><textarea id="doctor-review-ack-'+Number(r.id)+'" rows="3" placeholder="Enter nursing instructions or the discharge authorization…"></textarea><div class="doc-round-action-buttons"><button type="button" class="btn btn-primary" onclick="acknowledgeDoctorNursingReview('+Number(r.id)+','+Number(data.patient.id)+',\'authorize_release\')">Authorize Discharge</button><button type="button" class="btn btn-secondary" onclick="acknowledgeDoctorNursingReview('+Number(r.id)+','+Number(data.patient.id)+',\'instructions\')">Send Instructions &amp; Keep Patient</button></div></div>').join('');
      reportsHost.innerHTML='<div class="doc-round-patient-heading"><strong>'+escapeHTML(data.patient.full_name)+'</strong><span>Patient ID: '+escapeHTML(data.patient.patient_id)+' · Bed '+escapeHTML(data.patient.bed_number)+'</span></div><section class="doc-round-record-section"><h4>Nurse follow-up reports ('+reports.length+')</h4>'+(reportHistory||'<p class="hms-muted">No nurse follow-up reports saved for this patient.</p>')+(newInputs?'<div class="doc-round-new-inputs"><h4>New Doctor Response</h4>'+newInputs+'</div>':'')+'</section>';
      sessionsHost.innerHTML='<div class="doc-round-patient-heading"><strong>'+escapeHTML(data.patient.full_name)+'</strong><span>Patient ID: '+escapeHTML(data.patient.patient_id)+' · Bed '+escapeHTML(data.patient.bed_number)+'</span></div><div id="doc-round-nursing-sessions"></div>';
      if(typeof renderDoctorNursingRecords==='function')renderDoctorNursingRecords($('doc-round-nursing-sessions'),sessions);
      commentsHost.innerHTML='<div class="doc-round-patient-heading"><strong>'+escapeHTML(data.patient.full_name)+'</strong><span>Patient ID: '+escapeHTML(data.patient.patient_id)+' · Bed '+escapeHTML(data.patient.bed_number)+'</span></div><section class="doc-round-record-section"><h4>Doctor rounds comments ('+notes.length+')</h4>'+(notes.length?notes.map(n=>'<article class="doc-round-entry"><div><strong>'+escapeHTML(n.doctor_name||'Doctor')+'</strong><time>'+escapeHTML(n.created_at?new Date(n.created_at).toLocaleString():'Date not recorded')+'</time></div><p>'+escapeHTML(n.note)+'</p></article>').join(''):'<p class="hms-muted">No rounds comments saved for this patient.</p>')+'</section>';
    }catch(error){for(const host of [reportsHost,sessionsHost,commentsHost])host.innerHTML='<p class="hms-error">'+escapeHTML(error.message)+'</p>';}
  }
  window.toggleDoctorRounds=()=>{
    const rounds=$('doc-nursing-rounds'),toggle=$('doc-nursing-rounds-toggle');
    if(!rounds)return;
    const opening=rounds.hidden;
    rounds.hidden=!opening;
    rounds.style.setProperty('display',opening?'block':'none','important');
    rounds.classList.toggle('active',opening);
    const consultation=$('doc-consultation-workspace');
    if(consultation)consultation.hidden=opening;
    const consultationSaveActions=document.querySelector('.doctor-consultation-actions');
    if(consultationSaveActions)consultationSaveActions.hidden=opening;
    if(toggle){toggle.setAttribute('aria-expanded',String(opening));toggle.hidden=opening;}
    if(opening){loadRoundsPatients();rounds.scrollIntoView({behavior:'smooth',block:'start'});}
  };
  window.closeDoctorRounds=()=>{
    const rounds=$('doc-nursing-rounds'),toggle=$('doc-nursing-rounds-toggle');
    if(!rounds)return;
    rounds.hidden=true;rounds.style.display='';
    rounds.classList.remove('active');
    const consultation=$('doc-consultation-workspace');
    if(consultation)consultation.hidden=false;
    const consultationSaveActions=document.querySelector('.doctor-consultation-actions');
    if(consultationSaveActions)consultationSaveActions.hidden=false;
    if(toggle){toggle.hidden=false;toggle.setAttribute('aria-expanded','false');}
    $('doc-patient-select')?.closest('.card')?.scrollIntoView({behavior:'smooth',block:'start'});
    $('doc-patient-select')?.focus({preventScroll:true});
  };
  document.addEventListener('DOMContentLoaded',()=>{
    if(!$('doc-nursing-rounds'))return;
    const rounds=$('doc-nursing-rounds');
    const consultationSaveActions=document.querySelector('.doctor-consultation-actions');
    if(consultationSaveActions)consultationSaveActions.hidden=!rounds.hidden;
    rounds.querySelectorAll('[data-doc-round-tab]').forEach(button=>button.addEventListener('click',()=>{
      const target=button.dataset.docRoundTab;
      rounds.querySelectorAll('[data-doc-round-tab]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
      rounds.querySelectorAll('.doc-round-panel').forEach(panel=>{panel.hidden=panel.id!=='doc-round-panel-'+target;});
    }));
    window.refreshDoctorRoundsPatients=()=>loadRoundsPatients();
    window.refreshDoctorRoundsPatient=()=>{const id=selectedRoundPatientId();if(id)loadRoundsPatient(id);};
    $('doc-nursing-round-patient')?.addEventListener('change',e=>{const id=selectedRoundPatientId();if(id)loadRoundsPatient(id);else clearRoundPanels('Choose a patient from the search suggestions to load records.');});
    $('doc-nursing-round-patient')?.addEventListener('input',e=>{if(!selectedRoundPatientId())clearRoundPanels('Choose a patient from the search suggestions to load records.');});
    $('doc-nursing-round-refresh')?.addEventListener('click',()=>loadRoundsPatients());
    $('doc-nursing-round-form')?.addEventListener('submit',async e=>{
      e.preventDefault();const patientId=selectedRoundPatientId();const note=$('doc-nursing-round-note')?.value.trim();
      if(!patientId||!note)return;
      const button=e.currentTarget.querySelector('button[type="submit"]');if(button)button.disabled=true;
      try{const response=await fetch('/api/doctor/nursing-rounds/patient/'+encodeURIComponent(patientId),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({note})});const data=await response.json().catch(()=>({}));if(!response.ok||!data.success)throw new Error(data.error||'Rounds comment was not saved.');$('doc-nursing-round-note').value='';await loadRoundsPatient(patientId);}
      catch(error){alert(error.message)}finally{if(button)button.disabled=false;}
    });
    loadRoundsPatients(false);
  });
})();

document.addEventListener('DOMContentLoaded',()=>{const doctorPatientSelect=document.getElementById('doc-patient-select');if(doctorPatientSelect)doctorPatientSelect.addEventListener('change',()=>{if(typeof loadDoctorNursingReviewReports==='function')loadDoctorNursingReviewReports();});});


// Shared conversation history and Secretariat Document Store attachment picker.
(function(){
  const labels={hospital_administration:'Hospital Administration',accounts:'Finance',procurement:'Procurement'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,opts={}){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...opts});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success)throw new Error(d.error||'Communication request failed.');return d;}
  async function refresh(panel){const history=panel.querySelector('[data-chat-history]'),status=panel.querySelector('[data-chat-status]');history.innerHTML='<p>Loading conversation history…</p>';try{
    const [m,d]=await Promise.all([api('/api/department-communication/messages'),api('/api/department-communication/documents')]);
    const dept=m.department;panel.querySelectorAll('select[name="recipient_department"]').forEach(sel=>[...sel.options].forEach(o=>o.disabled=!!o.value&&o.value===dept));
    const items=[...(m.messages||[]).map(x=>({...x,kind:'message',time:x.created_at})),...(d.documents||[]).map(x=>({...x,kind:'document',time:x.created_at}))].sort((a,b)=>new Date(b.time)-new Date(a.time));
    history.innerHTML=items.length?items.map(x=>`<article class="department-chat-item"><div class="department-chat-item-head"><strong>${esc(labels[x.sender_department]||x.sender_department)} → ${esc(labels[x.recipient_department]||x.recipient_department)}</strong><small>${esc(x.sender_name||x.uploaded_by||'Staff')} · ${esc(new Date(x.time).toLocaleString())}</small></div>${x.kind==='message'?`<p>${esc(x.message)}</p>`:`<p><strong>📎 ${esc(x.title)}</strong><br>${esc(x.original_filename)}</p><a href="${esc(x.download_url)}">Download attachment</a>`}<div class="department-chat-item-actions"><button type="button" class="btn btn-secondary btn-small" data-delete-kind="${x.kind}" data-delete-id="${Number(x.id)}">Delete from history</button></div></article>`).join(''):'<p>No conversation history yet. Send a message or attach a file above.</p>';
    status.textContent='History updated.';
  }catch(e){history.innerHTML='<p class="hms-error">Could not load conversation history.</p>';status.textContent=e.message;}}
  const dialog=()=>document.getElementById('department-chat-store-dialog');
  async function openPicker(panel){const dlg=dialog();if(!dlg)return;dlg.hidden=false;dlg.querySelector('[data-chat-store-list]').innerHTML='<p>Loading documents…</p>';dlg.querySelector('[data-chat-store-search]').value='';const form=panel.querySelector('[data-chat-send-form]'),storeHint=String(panel.dataset.forwardingStore||'').toLowerCase();const procurement=storeHint==='procurement'||panel.id==='procurement-forwarding'||!!form?.querySelector('input[name="procurement_document_id"]'),finance=storeHint==='finance'||panel.id==='accounts-forwarding'||!!form?.querySelector('input[name="accounts_dispensing_document_id"]');dlg.dataset.storeKind=procurement?'procurement':finance?'finance':'secretariat';dlg.querySelector('#department-chat-store-title').textContent=procurement?'Choose from Procurement Document Store':finance?'Choose from Funds Dispensing Documents':'Choose from Secretariat Document Store';try{
    const url=procurement?'/api/office/procurement/documents':finance?'/api/department-communication/accounts-dispensing':'/api/office/secretariate/documents';const data=await api(url);const docs=(data.documents||[]);dlg._documents=docs;renderPicker(dlg,docs);
  }catch(err){dlg.querySelector('[data-chat-store-list]').innerHTML=`<p class="hms-error">${esc(err.message)}</p>`;}}
  function renderPicker(dlg,docs){const list=dlg.querySelector('[data-chat-store-list]');const kind=dlg.dataset.storeKind,procurement=kind==='procurement',finance=kind==='finance';list.innerHTML=docs.length?docs.map(d=>`<article class="department-chat-store-choice"><div><strong>${esc(d.title||('Dispensing document '+(d.reference||'')))}</strong><small>${esc(finance?d.recipient:(d.document_type||'Document'))}${d.original_filename?' · '+esc(d.original_filename):' · Stored document content'}</small><small>${esc(d.created_at||d.document_date||'')} · ${finance?'Template-generated PDF':'Will be sent as PDF'}</small></div><button type="button" class="btn btn-primary btn-small" data-chat-choose-store="${Number(d.id)}">Choose</button></article>`).join(''):`<p>No documents found in the ${finance?'Funds Dispensing':procurement?'Procurement':'Secretariat'} Document Store.</p>`;}
  function showSelectedSecretariateDocument(form,doc){
    let preview=form.querySelector('[data-chat-secretariate-preview]');
    if(!preview){preview=document.createElement('section');preview.dataset.chatSecretariatePreview='';preview.className='department-chat-selected-document';const anchor=form.querySelector('[data-chat-selected-store-file]');anchor?.insertAdjacentElement('afterend',preview);}
    try{const normalize=window.hmsSecretariateDocumentFromStore,render=window.renderHmsSecretariateDocument;if(typeof normalize!=='function'||typeof render!=='function')throw new Error('Document renderer is unavailable.');preview.innerHTML='<div class="department-chat-selected-document-head"><strong>Selected Secretariat document</strong><span>Document Store view</span></div>'+render(normalize(doc));}catch(_){preview.innerHTML='<div class="department-chat-selected-document-head"><strong>Selected Secretariat document</strong></div><p>'+esc(doc.title||'Document selected')+'</p>';}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-department-chat]').forEach(panel=>{
      panel.querySelector('[data-chat-send-form]')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,status=panel.querySelector('[data-chat-status]'),btn=form.querySelector('button[type="submit"]');if(btn)btn.disabled=true;try{const data=new FormData(form);if(!String(data.get('message')||'').trim()&&!data.get('file')?.name&&!data.get('secretariate_document_id')&&!data.get('procurement_document_id')&&!data.get('accounts_dispensing_document_id'))throw new Error('Write a message or choose a file.');const result=await api('/api/department-communication/send',{method:'POST',body:data});form.reset();form.querySelector('[data-chat-secretariate-preview]')?.remove();panel.querySelector('[data-chat-selected-store-file]').textContent='No document selected from the store.';status.textContent=result.warning||'Sent successfully.';await refresh(panel);}catch(err){status.textContent=err.message;}finally{if(btn)btn.disabled=false;}});
      panel.querySelector('[data-chat-store-picker]')?.addEventListener('click',()=>{dialog().dataset.activePanel='';dialog()._targetForm=panel.querySelector('[data-chat-send-form]');openPicker(panel);});
      panel.querySelector('[data-chat-refresh]')?.addEventListener('click',()=>refresh(panel));
      panel.addEventListener('click',async e=>{const btn=e.target.closest('[data-delete-kind]');if(!btn)return;if(!confirm('Delete this item from the shared conversation history? This cannot be undone.'))return;btn.disabled=true;try{const path=btn.dataset.deleteKind==='message'?`/api/department-communication/messages/${btn.dataset.deleteId}`:`/api/department-communication/documents/${btn.dataset.deleteId}`;await api(path,{method:'DELETE'});panel.querySelector('[data-chat-status]').textContent='Item deleted.';await refresh(panel);}catch(err){panel.querySelector('[data-chat-status]').textContent=err.message;btn.disabled=false;}});
      const fileInput=panel.querySelector('input[name="file"]');fileInput?.addEventListener('change',()=>{if(fileInput.files?.length){panel.querySelector('[data-chat-selected-store-file]').textContent='Using local file: '+fileInput.files[0].name+' (store attachment, if selected, will also be sent).';}});
      refresh(panel);
    });
    const dlg=dialog();if(!dlg)return;
    dlg.querySelector('[data-chat-store-close]')?.addEventListener('click',()=>dlg.hidden=true);
    dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.hidden=true;const btn=e.target.closest('[data-chat-choose-store]');if(!btn)return;const doc=(dlg._documents||[]).find(d=>Number(d.id)===Number(btn.dataset.chatChooseStore));if(!doc||!dlg._targetForm)return;const form=dlg._targetForm,kind=dlg.dataset.storeKind,isProcurement=kind==='procurement',isFinance=kind==='finance';const selectedName=isProcurement?'procurement_document_id':isFinance?'accounts_dispensing_document_id':'secretariate_document_id';const selectedField=form.querySelector('input[name="'+selectedName+'"]');if(selectedField)selectedField.value=String(doc.id);['secretariate_document_id','procurement_document_id','accounts_dispensing_document_id'].filter(name=>name!==selectedName).forEach(name=>{const field=form.querySelector('input[name="'+name+'"]');if(field)field.value='';});form.querySelector('[data-chat-selected-store-file]').textContent='Selected: '+(doc.title||('Dispensing document '+doc.reference))+' ('+(doc.original_filename||'template document')+')'+(form.querySelector('input[name="file"]').files?.length?' plus local attachment':'')+' — ready to forward as PDF.';if(kind==='secretariat')showSelectedSecretariateDocument(form,doc);else form.querySelector('[data-chat-secretariate-preview]')?.remove();dlg.hidden=true;});
    dlg.querySelector('[data-chat-store-search]')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();renderPicker(dlg,(dlg._documents||[]).filter(d=>`${d.title} ${d.document_type} ${d.original_filename} ${d.content||''}`.toLowerCase().includes(q)));});
  });
})();
