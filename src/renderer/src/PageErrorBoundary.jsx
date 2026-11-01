import { Component } from 'react';
import PageHeader from './ui/PageHeader.jsx';
import { Button } from './ui/Button.jsx';
import './pageError.css';

export default class PageErrorBoundary extends Component {
  state = { failed: false, error: null };

  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`self-wiki ${this.props.label || '页面'}显示失败`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const label = this.props.label || '页面';
    return <main className="wiki-main page-error" id="main-content">
      <section role="alert" className="page-error-content">
        <PageHeader title={`${label}暂时无法显示`} />
        <p>页面加载或显示时出现错误，请刷新页面重试。</p>
        {this.props.label && <p>也可以通过侧栏切换到其他页面。</p>}
        <p className="page-error-hint">刷新页面可能丢失尚未保存的内容。</p>
        <Button variant="primary" onClick={() => window.location.reload()}>刷新页面</Button>
        <details>
          <summary>查看错误详情</summary>
          <pre>{this.state.error?.stack || String(this.state.error)}</pre>
        </details>
      </section>
    </main>;
  }
}
