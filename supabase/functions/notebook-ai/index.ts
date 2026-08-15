import { withCors } from '../_shared/http.ts'
import { handleNotebookAiRequest } from './handler.ts'

Deno.serve(withCors(handleNotebookAiRequest))
