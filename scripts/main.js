/**
 * GURPS Counter Module for Foundry VTT v12
 * Automatically decreases numbered status effects on tokens each combat round
 * Manages Luck effect with timed reactivation
 */


// Initialize the counter system when the module loads
Hooks.once('init', function() {
  console.log("GURPS Counter | Setting up combat counter system");
  
  // Clean up any existing hook
  if (globalThis._myCounterHookId) {
    Hooks.off("updateCombat", globalThis._myCounterHookId);
  }
  
  // Define the counter hook function
  globalThis._myCounterHookId = async function (combat, data) {
    if (!("round" in data || "turn" in data)) return;
    const token = canvas.tokens.get(combat.current.tokenId);
    if (!token) return;
    const actor = token.actor;
    if (!actor) return;
    const BASE_ICON_PATH = "systems/gurps/icons/statuses/number-";
    const effect = actor.effects.find(e =>
      [...(e.statuses ?? [])].some(s => /^num\d+$/.test(s))
    );
    if (!effect) return;
    // Extrai número do statusId, como num10 → 10
    const statusId = [...effect.statuses][0];
    const match = statusId.match(/num(\d+)/);
    if (!match) return await effect.delete();
    let num = parseInt(match[1], 10) - 1;
    await effect.delete(); // sempre remove o antigo
    if (num > 0) {
      const status = `num${num}`;
      await ActiveEffect.create({
        icon: `${BASE_ICON_PATH}${num}.webp`,
        label: "Counter",
        name: "Counter",
        statuses: [status]
      }, { parent: actor });
    }
  };
  
  // Register the combat update hook
  Hooks.on("updateCombat", globalThis._myCounterHookId);
  
  // Add Lucky Clover Button to Token Controls
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokenControls = controls.tokens;
    if (tokenControls && tokenControls.tools) {
      tokenControls.tools["gurps-counter-clover"] = {
        name: "gurps-counter-clover",
        title: "Luck Timer System",
        icon: "fas fa-clover",
        button: true,
        onClick: () => {
          openTimerDialog();
        },
        visible: true
      };
    }
  });
  
  // Global timer variables
  globalThis._luckTimer = null;
  globalThis._timerInterval = null;
  globalThis._lastTimerMinutes = 1.0;
  globalThis._trackedTokens = new Set(); // Track which tokens are being monitored
  
  // Function to use the luck effect (remove it and restart timer)
  async function useLuck() {
    let controlledTokens = canvas.tokens.controlled;
    
    if (controlledTokens.length === 0) {
      ui.notifications.warn("Selecione pelo menos um token para usar a Luck");
      return;
    }
    
    let effectsRemoved = 0;
    
    for (let token of controlledTokens) {
      if (!token.actor) {
        console.log(`GURPS Counter | Token ${token.name} has no actor, skipping`);
        continue;
      }
      
      // Find and remove the luck effect
      const luckEffect = token.actor.effects.find(e => 
        e.icon === "icons/magic/control/buff-luck-fortune-clover-green.webp"
      );
      
      if (luckEffect) {
        await luckEffect.delete();
        effectsRemoved++;
        globalThis._trackedTokens.add(token.id); // Add token to tracking
        console.log(`GURPS Counter | Used Luck on ${token.name}, added to tracking`);
      }
    }
    
    if (effectsRemoved > 0) {
      ui.notifications.info(`Luck usado em ${effectsRemoved} token(s)`);
      
      // ALWAYS restart the timer when luck is used (if we have a configured time)
      if (globalThis._lastTimerMinutes > 0) {
        console.log("GURPS Counter | Restarting Luck timer after use");
        stopLuckTimer();
        startLuckTimer(globalThis._lastTimerMinutes);
        ui.notifications.info(`Timer reiniciado: ${globalThis._lastTimerMinutes} minutos`);
      } else {
        ui.notifications.warn("Configure um tempo primeiro para reiniciar o timer");
      }
    } else {
      ui.notifications.warn("Nenhum efeito de Luck encontrado nos tokens selecionados");
    }
  }
  
  // Function to apply initial luck to selected tokens
  async function applyInitialLuck() {
    let controlledTokens = canvas.tokens.controlled;
    
    if (controlledTokens.length === 0) {
      ui.notifications.warn("Selecione pelo menos um token para aplicar Luck");
      return;
    }
    
    let effectsApplied = 0;
    
    for (let token of controlledTokens) {
      if (!token.actor) {
        console.log(`GURPS Counter | Token ${token.name} has no actor, skipping`);
        continue;
      }
      
      // Check if luck effect already exists
      const hasLuckEffect = token.actor.effects.some(e => 
        e.icon === "icons/magic/control/buff-luck-fortune-clover-green.webp"
      );
      
      if (!hasLuckEffect) {
        try {
          await ActiveEffect.create({
            icon: "icons/magic/control/buff-luck-fortune-clover-green.webp",
            label: "Luck",
            name: "Luck",
            statuses: ["luck"]
          }, { parent: token.actor });
          
          effectsApplied++;
          console.log(`GURPS Counter | Applied initial Luck to ${token.name}`);
        } catch (error) {
          console.error(`GURPS Counter | Error applying Luck to ${token.name}:`, error);
        }
      }
    }
    
    if (effectsApplied > 0) {
      ui.notifications.info(`Luck aplicada em ${effectsApplied} token(s)`);
    } else {
      ui.notifications.info("Todos os tokens selecionados já possuem Luck");
    }
  }
  
  // Function to open the timer configuration dialog
  function openTimerDialog() {
    const currentInterval = globalThis._timerInterval ? (globalThis._timerInterval / (1000 * 60)).toFixed(1) : globalThis._lastTimerMinutes.toFixed(1);
    
    new Dialog({
      title: "Sistema de Luck - GURPS",
      content: `
        <div style="padding: 10px;">
          <div style="margin: 15px 0;">
            <label for="timer-minutes">Tempo para renovação (minutos):</label>
            <input type="number" id="timer-minutes" value="${currentInterval}" step="0.1" min="0.1" style="width: 80px; margin-left: 10px;">
          </div>
          <div style="margin: 15px 0;">
            <p><small>Status atual: ${globalThis._luckTimer ? '<span style="color: green;">Timer Ativo</span>' : '<span style="color: red;">Timer Inativo</span>'}</small></p>
            <p><small>Tokens monitorados: ${globalThis._trackedTokens.size}</small></p>
          </div>

        </div>
      `,
      buttons: {
        apply: {
          label: "Iniciar",
          callback: () => {
            applyInitialLuck();
          }
        },
        start: {
          label: "Iniciar Timer",
          callback: (html) => {
            const minutes = parseFloat(html.find("#timer-minutes").val());
            if (minutes && minutes > 0) {
              globalThis._lastTimerMinutes = minutes;
              
              // Apply luck to selected tokens first
              applyInitialLuck();
              
              // Then start the timer
              startLuckTimer(minutes);
              ui.notifications.info(`Luck aplicada e timer iniciado: ${minutes} minutos`);
            } else {
              ui.notifications.warn("Digite um tempo válido em minutos");
            }
          }
        },
        use: {
          label: "Usar Luck",
          callback: () => {
            useLuck();
          }
        },
        stop: {
          label: "Parar Timer",
          callback: () => {
            stopLuckTimer();
            ui.notifications.info("Timer de Luck parado");
          }
        },
        cancel: {
          label: "Fechar"
        }
      },
      default: "apply",
      render: (html) => {
        // Make dialog wider for better layout
        html.closest('.dialog').css('width', '500px');
      }
    }).render(true);
  }
  
  // Function to start the luck timer
  function startLuckTimer(minutes) {
    // Stop any existing timer
    stopLuckTimer();
    
    const intervalMs = minutes * 60 * 1000;
    globalThis._timerInterval = intervalMs;
    globalThis._lastTimerMinutes = minutes;
    
    globalThis._luckTimer = setInterval(async () => {
      console.log("GURPS Counter | Checking for Luck renewal...");
      
      if (globalThis._trackedTokens.size === 0) {
        console.log("GURPS Counter | No tokens being tracked for Luck renewal");
        return;
      }
      
      let effectsRenewed = 0;
      const tokensToRemove = new Set();
      
      // Check each tracked token
      for (let tokenId of globalThis._trackedTokens) {
        const token = canvas.tokens.get(tokenId);
        
        if (!token || !token.actor) {
          console.log(`GURPS Counter | Token ${tokenId} no longer exists, removing from tracking`);
          tokensToRemove.add(tokenId);
          continue;
        }
        
        // Check if the token already has luck
        const hasLuckEffect = token.actor.effects.some(e => 
          e.icon === "icons/magic/control/buff-luck-fortune-clover-green.webp"
        );
        
        console.log(`GURPS Counter | Token ${token.name} has Luck: ${hasLuckEffect}`);
        
        if (!hasLuckEffect) {
          console.log(`GURPS Counter | Renewing Luck for ${token.name}`);
          
          try {
            // Renew the luck effect
            await ActiveEffect.create({
              icon: "icons/magic/control/buff-luck-fortune-clover-green.webp",
              label: "Luck",
              name: "Luck",
              statuses: ["luck"]
            }, { parent: token.actor });
            
            effectsRenewed++;
            tokensToRemove.add(tokenId); // Remove from tracking since luck is renewed
            console.log(`GURPS Counter | Successfully renewed Luck for ${token.name}`);
          } catch (error) {
            console.error(`GURPS Counter | Error renewing Luck for ${token.name}:`, error);
          }
        }
      }
      
      // Clean up tracking list
      for (let tokenId of tokensToRemove) {
        globalThis._trackedTokens.delete(tokenId);
      }
      
      if (effectsRenewed > 0) {
        ui.notifications.info(`🍀 Luck renovada para ${effectsRenewed} token(s)`);
      } else {
        console.log("GURPS Counter | No Luck renewal needed");
      }
    }, intervalMs);
    
    console.log(`GURPS Counter | Luck timer started with ${minutes} minute interval`);
  }
  
  // Function to stop the luck timer
  function stopLuckTimer() {
    if (globalThis._luckTimer) {
      clearInterval(globalThis._luckTimer);
      globalThis._luckTimer = null;
      globalThis._timerInterval = null;
      console.log("GURPS Counter | Luck timer stopped");
    }
  }
  
  console.log("GURPS Counter | Combat counter system activated");
});

// Optional: Clean up when the module is disabled
Hooks.once('ready', function() {
  console.log("GURPS Counter | Module ready and active");
});

// Clean up timers when the world is closed
Hooks.once('canvasInit', function() {
  if (globalThis._luckTimer) {
    clearInterval(globalThis._luckTimer);
    globalThis._luckTimer = null;
    globalThis._timerInterval = null;
  }
  if (globalThis._trackedTokens) {
    globalThis._trackedTokens.clear();
  }
});
