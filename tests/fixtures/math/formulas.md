# 数学公式阅读测试

本文验证行内公式 $E=mc^2$，同时夹杂中文；也支持 \(a^2+b^2=c^2\) 写法。

普通价格文本：$99、$1,299.00，以及转义美元符号 \$50。它们不应成为公式。

## 多行公式

$$
\begin{aligned}
f(x) &= \frac{1}{\sqrt{2\pi}} e^{-x^2/2} \\
g(x) &= \sum_{k=1}^{n} k^2 + \int_0^1 x^2\,dx
\end{aligned}
$$

## 矩阵与求和

\[\begin{bmatrix} a & b \\ c & d \end{bmatrix}\]

## 代码中的美元符号

```latex
$x^2$ and \(y^2\), plus $99.
```

## 错误公式

$$
\frac{1}{
$$
