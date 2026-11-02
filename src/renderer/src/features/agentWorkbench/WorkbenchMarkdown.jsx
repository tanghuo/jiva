import { useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import './workbenchMarkdown.css';

const remarkPlugins = [remarkGfm, remarkMath];
const schema = {
  ...defaultSchema,
  // Every anchor is scoped below, after sanitization and before React creates DOM nodes.
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};

function scopeAnchors({ prefix }) {
  return tree => {
    function walk(node) {
      const props = node.properties;
      if (props) {
        for (const key of ['id', 'name']) if (props[key]) props[key] = prefix + props[key];
        if (typeof props.href === 'string' && props.href.startsWith('#')) props.href = '#' + prefix + props.href.slice(1);
        for (const key of ['ariaDescribedBy', 'ariaLabelledBy']) {
          if (Array.isArray(props[key])) props[key] = props[key].map(id => prefix + id);
        }
      }
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}

const components = {
  a: ({ children, href, node: _node, ...props }) => <a {...props} href={href} {...(href?.startsWith('#') ? { onClick: event => {
    // The app uses hash routing; footnotes must scroll without changing the route.
    event.preventDefault();
    const target = document.getElementById(href.slice(1));
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  } } : href ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>,
  table: ({ children, node: _node, ...props }) => <div className="workbench-markdown-table" role="region" aria-label="表格（可横向滚动）" tabIndex={0}><table {...props}>{children}</table></div>,
};

export default function WorkbenchMarkdown({ children }) {
  const prefix = `workbench-md-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  const rehypePlugins = [
    rehypeRaw,
    [rehypeSanitize, schema],
    [scopeAnchors, { prefix }],
    [rehypeKatex, { trust: false, throwOnError: false, maxExpand: 1000 }],
    [rehypeHighlight, { detect: false, ignoreMissing: true }],
  ];
  return <div className="workbench-markdown"><ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} remarkRehypeOptions={{ footnoteLabel: '脚注', footnoteBackLabel: '返回正文' }}>{children}</ReactMarkdown></div>;
}
