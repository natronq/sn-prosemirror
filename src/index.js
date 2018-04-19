// ProseMirrorView{
import { EditorView } from 'prosemirror-view'
import { EditorState } from 'prosemirror-state'
import {
  schema,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} from 'prosemirror-markdown'
import { exampleSetup } from 'prosemirror-example-setup'

class ComponentManager {
  constructor(permissions, onReady) {
    this.sentMessages = []
    this.messageQueue = []
    this.initialPermissions = permissions
    this.loggingEnabled = false
    this.acceptsThemes = true
    this.onReadyCallback = onReady

    this.coallesedSaving = true
    this.coallesedSavingDelay = 250

    window.addEventListener(
      'message',
      function(event) {
        if (this.loggingEnabled) {
          console.log('Components API Message received:', event.data)
        }
        this.handleMessage(event.data)
      }.bind(this),
      false
    )
  }

  handleMessage(payload) {
    if (payload.action === 'component-registered') {
      this.sessionKey = payload.sessionKey
      this.componentData = payload.componentData
      this.onReady(payload.data)

      if (this.loggingEnabled) {
        console.log('Component successfully registered with payload:', payload)
      }
    } else if (payload.action === 'themes') {
      if (this.acceptsThemes) {
        this.activateThemes(payload.data.themes)
      }
    } else if (payload.original) {
      // get callback from queue
      var originalMessage = this.sentMessages.filter(function(message) {
        return message.messageId === payload.original.messageId
      })[0]

      if (originalMessage.callback) {
        originalMessage.callback(payload.data)
      }
    }
  }

  onReady(data) {
    if (this.initialPermissions && this.initialPermissions.length > 0) {
      this.requestPermissions(this.initialPermissions)
    }

    for (var message of this.messageQueue) {
      this.postMessage(message.action, message.data, message.callback)
    }

    this.messageQueue = []
    this.environment = data.environment
    this.uuid = data.uuid

    if (this.onReadyCallback) {
      this.onReadyCallback()
    }
  }

  getSelfComponentUUID() {
    return this.uuid
  }

  isRunningInDesktopApplication() {
    return this.environment === 'desktop'
  }

  setComponentDataValueForKey(key, value) {
    this.componentData[key] = value
    this.postMessage(
      'set-component-data',
      { componentData: this.componentData },
      function(data) {}
    )
  }

  clearComponentData() {
    this.componentData = {}
    this.postMessage(
      'set-component-data',
      { componentData: this.componentData },
      function(data) {}
    )
  }

  componentDataValueForKey(key) {
    return this.componentData[key]
  }

  postMessage(action, data, callback) {
    if (!this.sessionKey) {
      this.messageQueue.push({
        action: action,
        data: data,
        callback: callback
      })
      return
    }

    var message = {
      action: action,
      data: data,
      messageId: this.generateUUID(),
      sessionKey: this.sessionKey,
      api: 'component'
    }

    var sentMessage = JSON.parse(JSON.stringify(message))
    sentMessage.callback = callback
    this.sentMessages.push(sentMessage)

    if (this.loggingEnabled) {
      console.log('Posting message:', message)
    }

    window.parent.postMessage(message, '*')
  }

  setSize(type, width, height) {
    this.postMessage(
      'set-size',
      { type: type, width: width, height: height },
      function(data) {}
    )
  }

  requestPermissions(permissions, callback) {
    this.postMessage(
      'request-permissions',
      { permissions: permissions },
      function(data) {
        callback && callback()
      }.bind(this)
    )
  }

  streamItems(contentTypes, callback) {
    if (!Array.isArray(contentTypes)) {
      contentTypes = [contentTypes]
    }
    this.postMessage(
      'stream-items',
      { content_types: contentTypes },
      function(data) {
        callback(data.items)
      }.bind(this)
    )
  }

  streamContextItem(callback) {
    this.postMessage('stream-context-item', null, data => {
      var item = data.item
      /*
        When an item is saved via saveItem, its updated_at value is set client side to the current date.
        If we make a change locally, then for whatever reason receive an item via streamItems/streamContextItem,
        we want to ignore that change if it was made prior to the latest change we've made.

        Update 1/22/18: However, if a user is restoring a note from version history, this change
        will not pass through this filter and will thus be ignored. Because the client now handles
        this case with isMetadataUpdate, we no longer need the below.
      */
      // if(this.streamedContextItem && this.streamedContextItem.uuid == item.uuid
      //   && this.streamedContextItem.updated_at > item.updated_at) {
      //   return;
      // }
      // this.streamedContextItem = item;
      callback(item)
    })
  }

  selectItem(item) {
    this.postMessage('select-item', { item: this.jsonObjectForItem(item) })
  }

  createItem(item, callback) {
    this.postMessage(
      'create-item',
      { item: this.jsonObjectForItem(item) },
      function(data) {
        var item = data.item
        this.associateItem(item)
        callback && callback(item)
      }.bind(this)
    )
  }

  associateItem(item) {
    this.postMessage('associate-item', { item: this.jsonObjectForItem(item) })
  }

  deassociateItem(item) {
    this.postMessage('deassociate-item', { item: this.jsonObjectForItem(item) })
  }

  clearSelection() {
    this.postMessage('clear-selection', { content_type: 'Tag' })
  }

  deleteItem(item) {
    this.deleteItems([item])
  }

  deleteItems(items) {
    var params = {
      items: items.map(
        function(item) {
          return this.jsonObjectForItem(item)
        }.bind(this)
      )
    }
    this.postMessage('delete-items', params)
  }

  sendCustomEvent(action, data, callback) {
    this.postMessage(
      action,
      data,
      function(data) {
        callback && callback(data)
      }.bind(this)
    )
  }

  saveItem(item, callback) {
    this.saveItems([item], callback)
  }

  saveItems(items, callback) {
    items = items.map(
      function(item) {
        item.updated_at = new Date()
        return this.jsonObjectForItem(item)
      }.bind(this)
    )

    let saveBlock = () => {
      this.postMessage('save-items', { items: items }, function(data) {
        callback && callback()
      })
    }

    /*
      Coallesed saving prevents saves from being made after every keystroke, and instead
      waits coallesedSavingDelay before performing action. For example, if a user types a keystroke, and the clienet calls saveItem,
      a 250ms delay will begin. If they type another keystroke within 250ms, the previously pending
      save will be cancelled, and another 250ms delay occurs. If ater 250ms the pending delay is not cleared by a future call,
      the save will finally trigger.

      Note: it's important to modify saving items updated_at immediately and not after delay. If you modify after delay,
      a delayed sync could just be wrapping up, and will send back old data and replace what the user has typed.
    */
    if (this.coallesedSaving == true) {
      if (this.pendingSave) {
        clearTimeout(this.pendingSave)
      }

      this.pendingSave = setTimeout(() => {
        saveBlock()
      }, this.coallesedSavingDelay)
    }
  }

  jsonObjectForItem(item) {
    var copy = Object.assign({}, item)
    copy.children = null
    copy.parent = null
    return copy
  }

  getItemAppDataValue(item, key) {
    let AppDomain = 'org.standardnotes.sn'
    var data = item.content.appData && item.content.appData[AppDomain]
    if (data) {
      return data[key]
    } else {
      return null
    }
  }

  /* Themes */

  activateThemes(urls) {
    this.deactivateAllCustomThemes()

    if (this.loggingEnabled) {
      console.log('Activating themes:', urls)
    }

    if (!urls) {
      return
    }

    for (var url of urls) {
      if (!url) {
        continue
      }

      var link = document.createElement('link')
      link.href = url
      link.type = 'text/css'
      link.rel = 'stylesheet'
      link.media = 'screen,print'
      link.className = 'custom-theme'
      document.getElementsByTagName('head')[0].appendChild(link)
    }
  }

  deactivateAllCustomThemes() {
    var elements = document.getElementsByClassName('custom-theme')

    ;[].forEach.call(elements, function(element) {
      if (element) {
        element.disabled = true
        element.parentNode.removeChild(element)
      }
    })
  }

  /* Utilities */

  generateUUID() {
    var crypto = window.crypto || window.msCrypto
    if (crypto) {
      var buf = new Uint32Array(4)
      crypto.getRandomValues(buf)
      var idx = -1
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(
        c
      ) {
        idx++
        var r = (buf[idx >> 3] >> ((idx % 8) * 4)) & 15
        var v = c == 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    } else {
      var d = new Date().getTime()
      if (window.performance && typeof window.performance.now === 'function') {
        d += performance.now() //use high-precision timer if available
      }
      var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
        /[xy]/g,
        function(c) {
          var r = ((d + Math.random() * 16) % 16) | 0
          d = Math.floor(d / 16)
          return (c == 'x' ? r : (r & 0x3) | 0x8).toString(16)
        }
      )
      return uuid
    }
  }
}

class ProseMirrorView {
  constructor(target, content) {
    this.view = new EditorView(target, {
      state: EditorState.create({
        doc: defaultMarkdownParser.parse(content),
        plugins: exampleSetup({ schema })
      })
    })
  }

  get content() {
    return defaultMarkdownSerializer.serialize(this.view.state.doc)
  }
  focus() {
    this.view.focus()
  }
  destroy() {
    this.view.destroy()
  }
}
// }

document.addEventListener('DOMContentLoaded', function(event) {
  var workingNote
  var view

  let permissions = [
    {
      name: 'stream-context-item'
    }
  ]

  var componentManager = new ComponentManager(permissions, function() {
    // on ready
  })

  // componentManager.loggingEnabled = true;

  componentManager.streamContextItem(note => {
    workingNote = note

    // Only update UI on non-metadata updates.
    if (note.isMetadataUpdate) {
      return
    }

    if (view) {
      view.destroy()
    }

    view = new ProseMirrorView(
      document.querySelector('#editor'),
      note.content.text
    )
  })

  editor.addEventListener('input', function(event) {
    var text = view.content || ''
    if (workingNote) {
      workingNote.content.text = text
      componentManager.saveItem(workingNote)
    }
  })

  // Tab handler
  editor.addEventListener('keydown', function(event) {
    if (!event.shiftKey && event.which == 9) {
      event.preventDefault()

      console.log(document)

      // Using document.execCommand gives us undo support
      if (!document.execCommand('insertText', false, '\t')) {
        // document.execCommand works great on Chrome/Safari but not Firefox
        var start = this.selectionStart
        var end = this.selectionEnd
        var spaces = '    '

        // Insert 4 spaces
        this.value =
          this.value.substring(0, start) + spaces + this.value.substring(end)

        // Place cursor 4 spaces away from where
        // the tab key was pressed
        this.selectionStart = this.selectionEnd = start + 4
      }
    }
  })
})
