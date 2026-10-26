import { useState } from 'react';
import { Check, Copy, ExternalLink, FlaskConical, Share2, X } from 'lucide-react';
import Button from '../../ui/Button';
import StatusMessage from '../../ui/StatusMessage';
import { Input, Textarea } from '../../ui/Field';
import { toast } from '../../ui/Toast';
import { createTestInterview } from '../../../api/application/testInterview';

const DEFAULT_NAME = 'Candidato Teste';
const DEFAULT_RESUME =
  'Trabalhei 2 anos como operador de caixa em um supermercado de bairro, atendendo clientes, ' +
  'conferindo troco e lidando com reclamações no balcão. Antes disso, fiz um estágio de 6 meses ' +
  'em uma loja de cosméticos. Ensino médio completo, curso de atendimento ao cliente pelo Senac.';

interface TestInterviewPanelProps {
  jobId: string;
  darkMode: boolean;
}

/** Creates a throwaway candidate for this job and hands back a ready interview link. */
function TestInterviewPanel({ jobId, darkMode }: Readonly<TestInterviewPanelProps>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(DEFAULT_NAME);
  const [resume, setResume] = useState(DEFAULT_RESUME);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setCreating(true);
    setError('');
    setLink('');
    try {
      const { interviewUrl } = await createTestInterview({ jobId, name: name.trim() || DEFAULT_NAME, resumeText: resume });
      setLink(interviewUrl);
      toast.success('Link de teste gerado');
    } catch (err) {
      console.error('Error creating test interview:', err);
      setError('Não foi possível gerar o link de teste. Verifique sua conexão e tente novamente.');
    } finally {
      setCreating(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => toast.error('Não foi possível copiar o link', { description: link }),
    );
  };

  const share = () => {
    navigator.share?.({ title: 'Entrevista de teste — TriaGen', url: link }).catch(() => {});
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} icon={FlaskConical} iconPosition="left" darkMode={darkMode}>
        Gerar link de teste
      </Button>
    );
  }

  return (
    <div className={`w-full p-5 sm:p-6 rounded-lg border ${darkMode ? 'bg-gray-900/50 border-gray-700' : 'bg-white border-triagen-border-light'}`}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className={`font-heading text-xl ${darkMode ? 'text-white' : 'text-triagen-primary'}`}>Entrevista de teste</h2>
          <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-triagen-secondary'}`}>
            Cria um candidato de teste nesta vaga e gera um link de entrevista novo. Gere quantos quiser.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fechar"
          className={`shrink-0 w-11 h-11 flex items-center justify-center rounded-lg ${darkMode ? 'text-gray-400 hover:bg-gray-800' : 'text-triagen-secondary hover:bg-neutral-100'}`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <Input label="Nome" darkMode={darkMode} value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          label="Currículo"
          darkMode={darkMode}
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          rows={4}
          hint="A IA usa este texto para personalizar a entrevista."
        />

        {error && <StatusMessage type="error" message={error} darkMode={darkMode} />}

        <Button variant="primary" size="lg" fullWidth onClick={generate} isLoading={creating} icon={FlaskConical} iconPosition="left">
          {creating ? 'Gerando...' : link ? 'Gerar outro link' : 'Gerar link de teste'}
        </Button>

        {link && (
          <div className={`flex flex-col gap-3 pt-4 border-t ${darkMode ? 'border-gray-700' : 'border-triagen-border-light'}`}>
            <p className={`text-sm break-all font-mono ${darkMode ? 'text-gray-200' : 'text-triagen-primary'}`}>{link}</p>
            <Button variant="primary" size="lg" fullWidth onClick={() => window.open(link, '_blank', 'noopener')} icon={ExternalLink} iconPosition="left">
              Abrir entrevista
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" onClick={copy} icon={copied ? Check : Copy} iconPosition="left" darkMode={darkMode} className={typeof navigator.share === 'function' ? '' : 'col-span-2'}>
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
              {typeof navigator.share === 'function' && (
                <Button variant="outline" size="lg" onClick={share} icon={Share2} iconPosition="left" darkMode={darkMode}>
                  Enviar
                </Button>
              )}
            </div>
            <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              Cada link vale para uma entrevista. Para testar de novo, gere outro.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default TestInterviewPanel;
