// MarkdownView{
class MarkdownView {
  constructor(target, content) {
    this.textarea = target.appendChild(document.createElement('textarea'))
    this.textarea.value = content
  }

  get content() {
    return this.textarea.value
  }
  focus() {
    this.textarea.focus()
  }
  destroy() {
    this.textarea.remove()
  }
}
// }

// ProseMirrorView{
import { EditorView } from 'prosemirror-view'
import { EditorState } from 'prosemirror-state'
import {
  schema,
  defaultMarkdownParser,
  defaultMarkdownSerializer
} from 'prosemirror-markdown'
import { exampleSetup } from 'prosemirror-example-setup'

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
  var place = document.querySelector('#editor')
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

    view = new ProseMirrorView(place, note.content.text)
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
